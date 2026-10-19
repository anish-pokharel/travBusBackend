const VehicleLayout = require('../models/VehicleLayout');
const Vehicle = require('../models/Vehicle');
const Trip = require('../models/Trip');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const audit = require('../utils/audit');
const { validateLayout } = require('../utils/layoutValidator');
const { TEMPLATE_LIST, build } = require('../utils/layoutTemplates');
const crypto = require('crypto');

const pick = (b) => ({
  name: b.name, vehicleType: b.vehicleType, rows: b.rows, columns: b.columns,
  dimensions: b.dimensions, aisleWidth: b.aisleWidth, seats: b.seats || [], elements: b.elements || [],
});

exports.templates = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: TEMPLATE_LIST.map(([key, label]) => ({ key, label })) });
});

exports.buildTemplate = asyncHandler(async (req, res) => {
  const layout = build(req.params.key, { rows: parseInt(req.query.rows, 10) || undefined, numbering: req.query.numbering });
  if (!layout) throw ApiError.notFound('Unknown template');
  res.json({ success: true, data: { ...layout, validation: validateLayout(layout) } });
});

// stateless validation so the designer can highlight errors live
exports.validate = asyncHandler(async (req, res) => {
  res.json({ success: true, data: validateLayout(pick(req.body)) });
});

exports.list = asyncHandler(async (req, res) => {
  const q = { status: req.query.status || 'active' };
  if (req.query.vehicleType) q.vehicleType = req.query.vehicleType;
  if (req.query.latestOnly === 'true') {
    const items = await VehicleLayout.aggregate([
      { $match: q }, { $sort: { version: -1 } },
      { $group: { _id: '$layoutKey', doc: { $first: '$$ROOT' } } },
      { $replaceRoot: { newRoot: '$doc' } }, { $project: { seats: 0, elements: 0 } }, { $sort: { name: 1 } },
    ]);
    return res.json({ success: true, data: items });
  }
  const items = await VehicleLayout.find(q).select('-seats -elements').sort({ name: 1, version: -1 });
  res.json({ success: true, data: items });
});

exports.get = asyncHandler(async (req, res) => {
  const layout = await VehicleLayout.findById(req.params.id);
  if (!layout) throw ApiError.notFound('Layout not found');
  const usedByTrips = await Trip.countDocuments({ layoutId: layout._id });
  res.json({ success: true, data: { ...layout.toObject(), usedByTrips } });
});

exports.create = asyncHandler(async (req, res) => {
  const data = pick(req.body);
  const v = validateLayout(data);
  if (!v.valid) throw ApiError.badRequest('Layout validation failed', v.errors);
  const layout = await VehicleLayout.create({
    ...data, layoutKey: crypto.randomUUID(), version: 1, createdBy: req.user._id, updatedBy: req.user._id,
  });
  await audit(req, 'layout.create', 'VehicleLayout', layout._id, { name: layout.name });
  res.status(201).json({ success: true, data: layout });
});

/**
 * Update rules (spec 6.7): if any trip already uses this layout version we never mutate it;
 * we create a NEW version instead so existing trips keep their seat identities and bookings.
 * Vehicles are re-pointed to the new version for FUTURE trips only.
 */
exports.update = asyncHandler(async (req, res) => {
  const layout = await VehicleLayout.findById(req.params.id);
  if (!layout) throw ApiError.notFound('Layout not found');
  const data = pick(req.body);
  const v = validateLayout(data);
  if (!v.valid) throw ApiError.badRequest('Layout validation failed', v.errors);

  const inUse = await Trip.exists({ layoutId: layout._id });
  if (!inUse) {
    Object.assign(layout, data, { updatedBy: req.user._id });
    layout.markModified('seats'); layout.markModified('elements');
    await layout.save();
    await audit(req, 'layout.update', 'VehicleLayout', layout._id);
    return res.json({ success: true, data: layout, versioned: false });
  }

  const latest = await VehicleLayout.findOne({ layoutKey: layout.layoutKey }).sort({ version: -1 });
  const next = await VehicleLayout.create({
    ...data, layoutKey: layout.layoutKey, version: latest.version + 1,
    createdBy: req.user._id, updatedBy: req.user._id,
  });
  // new trips on vehicles that used the old version use the new one; existing trips keep their pinned layout
  await Vehicle.updateMany({ layoutId: layout._id }, { $set: { layoutId: next._id, seatCapacity: next.bookableSeats } });
  await audit(req, 'layout.new_version', 'VehicleLayout', next._id, { from: layout._id, version: next.version });
  res.status(201).json({
    success: true, data: next, versioned: true,
    message: `This layout is used by existing trips, so version ${next.version} was created. Existing trips keep the old layout.`,
  });
});

exports.duplicate = asyncHandler(async (req, res) => {
  const src = await VehicleLayout.findById(req.params.id).lean();
  if (!src) throw ApiError.notFound('Layout not found');
  const copy = await VehicleLayout.create({
    ...pick(src), name: `${src.name} (copy)`, layoutKey: crypto.randomUUID(), version: 1,
    createdBy: req.user._id, updatedBy: req.user._id,
  });
  await audit(req, 'layout.duplicate', 'VehicleLayout', copy._id, { from: src._id });
  res.status(201).json({ success: true, data: copy });
});

exports.archive = asyncHandler(async (req, res) => {
  const layout = await VehicleLayout.findById(req.params.id);
  if (!layout) throw ApiError.notFound('Layout not found');
  if (await Vehicle.exists({ layoutId: layout._id, status: 'active' })) throw ApiError.conflict('Layout is assigned to an active vehicle');
  if (await Trip.exists({ layoutId: layout._id, status: { $in: ['scheduled', 'boarding'] } })) throw ApiError.conflict('Layout is used by upcoming trips');
  layout.status = 'archived';
  await layout.save();
  await audit(req, 'layout.archive', 'VehicleLayout', layout._id);
  res.json({ success: true, message: 'Layout archived' });
});

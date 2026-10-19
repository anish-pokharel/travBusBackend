const Vehicle = require('../models/Vehicle');
const VehicleLayout = require('../models/VehicleLayout');
const Trip = require('../models/Trip');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const audit = require('../utils/audit');
const { validateLayout } = require('../utils/layoutValidator');

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function activeTripCount(vehicleId) {
  return Trip.countDocuments({ vehicleId, status: { $in: ['scheduled', 'boarding'] }, departureAt: { $gte: new Date() } });
}

async function checkLayout(layoutId, vehicleType) {
  if (!layoutId) return null;
  const layout = await VehicleLayout.findById(layoutId);
  if (!layout || layout.status !== 'active') throw ApiError.badRequest('Selected layout does not exist or is archived');
  const v = validateLayout(layout);
  if (!v.valid) throw ApiError.badRequest('Assigned layout is invalid', v.errors);
  return layout;
}

exports.list = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(100, parseInt(req.query.limit || '20', 10));
  const q = {};
  if (req.query.type) q.vehicleType = req.query.type;
  if (req.query.status) q.status = req.query.status;
  if (req.query.search) {
    const rx = new RegExp(esc(req.query.search), 'i');
    q.$or = [{ name: rx }, { registrationNumber: rx }, { operator: rx }];
  }
  const [items, total] = await Promise.all([
    Vehicle.find(q).populate('layoutId', 'name version totalSeats bookableSeats').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Vehicle.countDocuments(q),
  ]);
  res.json({ success: true, data: items, meta: { page, limit, total } });
});

exports.get = asyncHandler(async (req, res) => {
  const v = await Vehicle.findById(req.params.id).populate('layoutId');
  if (!v) throw ApiError.notFound('Vehicle not found');
  res.json({ success: true, data: v });
});

exports.create = asyncHandler(async (req, res) => {
  const b = req.body;
  const layout = await checkLayout(b.layoutId, b.vehicleType);
  const v = await Vehicle.create({
    name: b.name, registrationNumber: b.registrationNumber, operator: b.operator, vehicleType: b.vehicleType,
    amenities: b.amenities || [], info: b.info, layoutId: layout?._id,
    seatCapacity: layout ? layout.bookableSeats : 0, status: b.status || 'active',
  });
  await audit(req, 'vehicle.create', 'Vehicle', v._id, { reg: v.registrationNumber });
  res.status(201).json({ success: true, data: v });
});

exports.update = asyncHandler(async (req, res) => {
  const v = await Vehicle.findById(req.params.id);
  if (!v) throw ApiError.notFound('Vehicle not found');
  const b = req.body;
  const active = await activeTripCount(v._id);

  const layoutChanged = b.layoutId && String(b.layoutId) !== String(v.layoutId);
  const typeChanged = b.vehicleType && b.vehicleType !== v.vehicleType;
  if (active && (layoutChanged || typeChanged || b.status === 'inactive')) {
    throw ApiError.conflict(`Vehicle has ${active} upcoming trip(s). Cancel or complete them before changing its layout, type or status.`);
  }
  if (layoutChanged) {
    const layout = await checkLayout(b.layoutId);
    v.layoutId = layout._id;
    v.seatCapacity = layout.bookableSeats;
  }
  ['name', 'registrationNumber', 'operator', 'vehicleType', 'amenities', 'info', 'status'].forEach((k) => {
    if (b[k] !== undefined) v[k] = b[k];
  });
  await v.save();
  await audit(req, 'vehicle.update', 'Vehicle', v._id);
  res.json({ success: true, data: v });
});

exports.setStatus = asyncHandler(async (req, res) => {
  const v = await Vehicle.findById(req.params.id);
  if (!v) throw ApiError.notFound('Vehicle not found');
  if (req.body.status === 'inactive' && (await activeTripCount(v._id))) {
    throw ApiError.conflict('Vehicle has upcoming trips and cannot be deactivated');
  }
  v.status = req.body.status;
  await v.save();
  await audit(req, `vehicle.${v.status}`, 'Vehicle', v._id);
  res.json({ success: true, data: v });
});

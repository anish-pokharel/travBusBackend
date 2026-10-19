const Route = require('../models/Route');
const Trip = require('../models/Trip');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const audit = require('../utils/audit');

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function normalizeStops(stops = [], durationMin, distanceKm) {
  const out = stops.map((s, i) => ({
    city: String(s.city || '').trim(), sequence: i + 1,
    arrivalOffsetMin: Number(s.arrivalOffsetMin || 0), departureOffsetMin: Number(s.departureOffsetMin || s.arrivalOffsetMin || 0),
    distanceFromStartKm: Number(s.distanceFromStartKm || 0),
  }));
  let prev = 0;
  out.forEach((s) => {
    if (!s.city) throw ApiError.badRequest('Every stop needs a city');
    if (s.departureOffsetMin < s.arrivalOffsetMin) throw ApiError.badRequest(`Stop ${s.city}: departure is before arrival`);
    if (s.arrivalOffsetMin < prev) throw ApiError.badRequest(`Stop ${s.city}: times must follow the stop sequence`);
    if (s.departureOffsetMin >= durationMin) throw ApiError.badRequest(`Stop ${s.city}: offset exceeds the journey duration`);
    if (distanceKm && s.distanceFromStartKm > distanceKm) throw ApiError.badRequest(`Stop ${s.city}: distance exceeds the route distance`);
    prev = s.departureOffsetMin;
  });
  return out;
}

exports.list = asyncHandler(async (req, res) => {
  const q = {};
  if (req.query.status) q.status = req.query.status;
  if (req.query.search) {
    const rx = new RegExp(esc(req.query.search), 'i');
    q.$or = [{ departureCity: rx }, { destinationCity: rx }, { name: rx }];
  }
  res.json({ success: true, data: await Route.find(q).sort({ departureCity: 1, destinationCity: 1 }) });
});

// public: city suggestions for the search form
exports.cities = asyncHandler(async (_req, res) => {
  const routes = await Route.find({ status: 'active' }, 'departureCity destinationCity stops.city').lean();
  const set = new Set();
  routes.forEach((r) => { set.add(r.departureCity); set.add(r.destinationCity); });
  res.json({ success: true, data: [...set].sort() });
});

exports.get = asyncHandler(async (req, res) => {
  const r = await Route.findById(req.params.id);
  if (!r) throw ApiError.notFound('Route not found');
  res.json({ success: true, data: r });
});

exports.create = asyncHandler(async (req, res) => {
  const b = req.body;
  if (b.departureCity.trim().toLowerCase() === b.destinationCity.trim().toLowerCase()) throw ApiError.badRequest('Departure and destination must differ');
  const route = await Route.create({
    departureCity: b.departureCity, destinationCity: b.destinationCity, distanceKm: b.distanceKm || 0,
    durationMin: b.durationMin, stops: normalizeStops(b.stops, b.durationMin, b.distanceKm), status: b.status || 'active',
  });
  await audit(req, 'route.create', 'Route', route._id);
  res.status(201).json({ success: true, data: route });
});

exports.update = asyncHandler(async (req, res) => {
  const route = await Route.findById(req.params.id);
  if (!route) throw ApiError.notFound('Route not found');
  const b = req.body;
  const upcoming = await Trip.countDocuments({ routeId: route._id, status: 'scheduled', departureAt: { $gte: new Date() } });
  if (upcoming && (b.status === 'inactive' || (b.durationMin && b.durationMin !== route.durationMin))) {
    throw ApiError.conflict(`Route has ${upcoming} upcoming trip(s). Cancel them first.`);
  }
  ['departureCity', 'destinationCity', 'distanceKm', 'durationMin', 'status'].forEach((k) => { if (b[k] !== undefined) route[k] = b[k]; });
  if (b.stops) route.stops = normalizeStops(b.stops, route.durationMin, route.distanceKm);
  route.name = `${route.departureCity} - ${route.destinationCity}`;
  await route.save();
  await audit(req, 'route.update', 'Route', route._id);
  res.json({ success: true, data: route });
});

exports.remove = asyncHandler(async (req, res) => {
  if (await Trip.exists({ routeId: req.params.id })) throw ApiError.conflict('Route has trips; deactivate it instead');
  const r = await Route.findByIdAndDelete(req.params.id);
  if (!r) throw ApiError.notFound('Route not found');
  await audit(req, 'route.delete', 'Route', req.params.id);
  res.json({ success: true, message: 'Route deleted' });
});

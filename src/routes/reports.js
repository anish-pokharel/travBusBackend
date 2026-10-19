const { Router } = require('express');
const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const Refund = require('../models/Refund');
const User = require('../models/User');
const Vehicle = require('../models/Vehicle');
const Route = require('../models/Route');
const Trip = require('../models/Trip');
const TripSeatInventory = require('../models/TripSeatInventory');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { authenticate, authorize, requireCounter } = require('../middleware/auth');

const r = Router();
r.use(authenticate);

const NPT = (5 * 60 + 45) * 60 * 1000;
const dayStart = (d = new Date()) => {
  const l = new Date(d.getTime() + NPT);
  return new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate()) - NPT);
};
const monthStart = () => { const l = new Date(Date.now() + NPT); return new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), 1) - NPT); };
const yearStart = () => { const l = new Date(Date.now() + NPT); return new Date(Date.UTC(l.getUTCFullYear(), 0, 1) - NPT); };

function range(q) {
  const to = q.to ? new Date(q.to) : new Date();
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 30 * 86400000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw ApiError.badRequest('Invalid date range');
  return { $gte: from, $lte: to };
}

function sendCsv(res, name, rows) {
  const keys = rows.length ? Object.keys(rows[0]) : [];
  const esc = (v) => { let s = v === null || v === undefined ? '' : String(v); if (/^[=+\-@]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; }; // CSV injection safe
  const csv = [keys.join(','), ...rows.map((row) => keys.map((k) => esc(row[k])).join(','))].join('\n');
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${name}.csv"`);
  res.send(csv);
}

// Only confirmed revenue counts. Refund amounts are reported separately.
const CONF = { status: 'confirmed' };

r.get('/dashboard', authorize('admin'), asyncHandler(async (_req, res) => {
  const now = new Date();
  const sumRevenue = async (from) => (await Payment.aggregate([
    { $match: { status: { $in: ['success', 'partially_refunded'] }, paidAt: { $gte: from } } },
    { $group: { _id: null, total: { $sum: { $subtract: ['$amount', { $ifNull: ['$refundedAmount', 0] }] } } } },
  ]))[0]?.total || 0;

  const [passengers, vehicles, activeVehicles, routes, todaysTrips, bookingsByStatus, seatStatus, today, month, year,
    counterSales, source, recent, trend, occupancy] = await Promise.all([
    User.countDocuments({ role: 'passenger' }),
    Vehicle.countDocuments(), Vehicle.countDocuments({ status: 'active' }), Route.countDocuments({ status: 'active' }),
    Trip.countDocuments({ departureAt: { $gte: dayStart(), $lt: new Date(dayStart().getTime() + 86400000) }, status: { $ne: 'cancelled' } }),
    Booking.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    TripSeatInventory.aggregate([
      { $lookup: { from: 'trips', localField: 'tripId', foreignField: '_id', as: 't' } }, { $unwind: '$t' },
      { $match: { 't.status': 'scheduled', 't.departureAt': { $gte: now } } },
      { $group: { _id: '$status', n: { $sum: 1 } } }]),
    sumRevenue(dayStart()), sumRevenue(monthStart()), sumRevenue(yearStart()),
    Booking.aggregate([{ $match: { ...CONF, source: 'counter' } }, { $group: { _id: '$counterId', bookings: { $sum: 1 }, revenue: { $sum: '$totalAmount' } } },
      { $lookup: { from: 'counters', localField: '_id', foreignField: '_id', as: 'c' } }, { $project: { name: { $arrayElemAt: ['$c.name', 0] }, bookings: 1, revenue: 1 } }, { $sort: { revenue: -1 } }]),
    Booking.aggregate([{ $match: CONF }, { $group: { _id: '$source', bookings: { $sum: 1 }, revenue: { $sum: '$totalAmount' } } }]),
    Payment.find({ status: { $ne: 'pending' } }).sort({ createdAt: -1 }).limit(8).populate('bookingId', 'pnr contact').lean(),
    Booking.aggregate([{ $match: { ...CONF, createdAt: { $gte: new Date(Date.now() - 14 * 86400000) } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: '+05:45' } }, bookings: { $sum: 1 }, revenue: { $sum: '$totalAmount' } } }, { $sort: { _id: 1 } }]),
    TripSeatInventory.aggregate([
      { $lookup: { from: 'trips', localField: 'tripId', foreignField: '_id', as: 't' } }, { $unwind: '$t' },
      { $match: { 't.status': { $in: ['scheduled', 'departed', 'completed'] }, 't.departureAt': { $gte: new Date(Date.now() - 30 * 86400000) }, status: { $ne: 'blocked' } } },
      { $group: { _id: '$t.routeId', total: { $sum: 1 }, booked: { $sum: { $cond: [{ $eq: ['$status', 'booked'] }, 1, 0] } } } },
      { $lookup: { from: 'routes', localField: '_id', foreignField: '_id', as: 'r' } }, { $project: { route: { $arrayElemAt: ['$r.name', 0] }, total: 1, booked: 1 } }, { $sort: { booked: -1 } }, { $limit: 8 }]),
  ]);
  const by = (arr) => arr.reduce((a, x) => { a[x._id] = x.n; return a; }, {});
  const bs = by(bookingsByStatus); const ss = by(seatStatus);
  res.json({ success: true, data: {
    passengers, vehicles: { total: vehicles, active: activeVehicles }, routes, todaysTrips,
    bookings: { total: Object.values(bs).reduce((a, b) => a + b, 0), confirmed: bs.confirmed || 0, pending: bs.held || 0, cancelled: (bs.cancelled || 0) + (bs.refunded || 0) },
    seats: { available: ss.available || 0, occupied: (ss.booked || 0) + (ss.held || 0), blocked: ss.blocked || 0 },
    revenue: { today, month, year }, counterSales, source, recent, trend, occupancy: occupancy.map((o) => ({ ...o, rate: o.total ? Math.round((o.booked / o.total) * 100) : 0 })),
  } });
}));

// ---- sales / breakdown reports (admin); counter staff only get their own counter's numbers ----
r.get('/sales', authorize('admin', 'counter'), requireCounter, asyncHandler(async (req, res) => {
  const groupBy = ['day', 'week', 'month', 'year'].includes(req.query.groupBy) ? req.query.groupBy : 'day';
  const fmt = { day: '%Y-%m-%d', week: '%G-W%V', month: '%Y-%m', year: '%Y' }[groupBy];
  const match = { ...CONF, createdAt: range(req.query) };
  if (req.user.role === 'counter') match.counterId = req.user.counterId;
  const rows = await Booking.aggregate([{ $match: match },
    { $group: { _id: { $dateToString: { format: fmt, date: '$createdAt', timezone: '+05:45' } }, bookings: { $sum: 1 }, tickets: { $sum: { $size: '$passengers' } }, revenue: { $sum: '$totalAmount' } } }, { $sort: { _id: 1 } }]);
  const data = rows.map((x) => ({ period: x._id, bookings: x.bookings, tickets: x.tickets, revenue: x.revenue }));
  if (req.query.format === 'csv') return sendCsv(res, 'sales', data);
  res.json({ success: true, data });
}));

r.get('/breakdown/:dim', authorize('admin'), asyncHandler(async (req, res) => {
  const dim = req.params.dim;
  const match = { ...CONF, createdAt: range(req.query) };
  const lookups = {
    route: [{ $lookup: { from: 'trips', localField: 'tripId', foreignField: '_id', as: 't' } }, { $unwind: '$t' }, { $group: { _id: '$t.routeId', bookings: { $sum: 1 }, revenue: { $sum: '$totalAmount' } } },
      { $lookup: { from: 'routes', localField: '_id', foreignField: '_id', as: 'x' } }, { $project: { name: { $arrayElemAt: ['$x.name', 0] }, bookings: 1, revenue: 1 } }],
    vehicle: [{ $lookup: { from: 'trips', localField: 'tripId', foreignField: '_id', as: 't' } }, { $unwind: '$t' }, { $group: { _id: '$t.vehicleId', bookings: { $sum: 1 }, revenue: { $sum: '$totalAmount' } } },
      { $lookup: { from: 'vehicles', localField: '_id', foreignField: '_id', as: 'x' } }, { $project: { name: { $concat: [{ $arrayElemAt: ['$x.name', 0] }, ' (', { $arrayElemAt: ['$x.registrationNumber', 0] }, ')'] }, bookings: 1, revenue: 1 } }],
    counter: [{ $match: { source: 'counter' } }, { $group: { _id: '$counterId', bookings: { $sum: 1 }, revenue: { $sum: '$totalAmount' } } },
      { $lookup: { from: 'counters', localField: '_id', foreignField: '_id', as: 'x' } }, { $project: { name: { $arrayElemAt: ['$x.name', 0] }, bookings: 1, revenue: 1 } }],
    staff: [{ $match: { source: 'counter' } }, { $group: { _id: '$staffId', bookings: { $sum: 1 }, revenue: { $sum: '$totalAmount' } } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'x' } }, { $project: { name: { $arrayElemAt: ['$x.name', 0] }, bookings: 1, revenue: 1 } }],
    source: [{ $group: { _id: '$source', bookings: { $sum: 1 }, revenue: { $sum: '$totalAmount' } } }, { $project: { name: '$_id', bookings: 1, revenue: 1 } }],
  };
  if (!lookups[dim]) throw ApiError.notFound('Unknown report dimension');
  const rows = await Booking.aggregate([{ $match: match }, ...lookups[dim], { $sort: { revenue: -1 } }]);
  const data = rows.map((x) => ({ name: x.name || 'Unknown', bookings: x.bookings, revenue: x.revenue }));
  if (req.query.format === 'csv') return sendCsv(res, `revenue-by-${dim}`, data);
  res.json({ success: true, data });
}));

r.get('/payment-methods', authorize('admin'), asyncHandler(async (req, res) => {
  const rows = await Payment.aggregate([{ $match: { createdAt: range(req.query) } },
    { $group: { _id: { method: '$method', status: '$status' }, count: { $sum: 1 }, amount: { $sum: '$amount' } } }, { $sort: { '_id.method': 1 } }]);
  const data = rows.map((x) => ({ method: x._id.method, status: x._id.status, count: x.count, amount: x.amount }));
  if (req.query.format === 'csv') return sendCsv(res, 'payment-methods', data);
  res.json({ success: true, data });
}));

r.get('/cancellations', authorize('admin'), asyncHandler(async (req, res) => {
  const [cancels, refunds] = await Promise.all([
    Booking.aggregate([{ $match: { status: { $in: ['cancelled', 'refunded'] }, cancelledAt: range(req.query) } }, { $group: { _id: null, bookings: { $sum: 1 }, amount: { $sum: '$totalAmount' } } }]),
    Refund.aggregate([{ $match: { createdAt: range(req.query) } }, { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$amount' } } }]),
  ]);
  const data = { cancellations: cancels[0] || { bookings: 0, amount: 0 }, refunds: refunds.map((x) => ({ status: x._id, count: x.count, amount: x.amount })) };
  if (req.query.format === 'csv') return sendCsv(res, 'cancellations', data.refunds);
  res.json({ success: true, data });
}));

r.get('/occupancy', authorize('admin'), asyncHandler(async (req, res) => {
  const rows = await TripSeatInventory.aggregate([
    { $lookup: { from: 'trips', localField: 'tripId', foreignField: '_id', as: 't' } }, { $unwind: '$t' },
    { $match: { 't.departureAt': range(req.query), 't.status': { $ne: 'cancelled' } } },
    { $group: { _id: '$tripId', dep: { $first: '$t.departureAt' }, vehicleId: { $first: '$t.vehicleId' }, routeId: { $first: '$t.routeId' },
      total: { $sum: { $cond: [{ $ne: ['$status', 'blocked'] }, 1, 0] } }, booked: { $sum: { $cond: [{ $eq: ['$status', 'booked'] }, 1, 0] } },
      available: { $sum: { $cond: [{ $eq: ['$status', 'available'] }, 1, 0] } } } },
    { $lookup: { from: 'routes', localField: 'routeId', foreignField: '_id', as: 'r' } },
    { $lookup: { from: 'vehicles', localField: 'vehicleId', foreignField: '_id', as: 'v' } },
    { $project: { departure: '$dep', route: { $arrayElemAt: ['$r.name', 0] }, vehicle: { $arrayElemAt: ['$v.name', 0] }, total: 1, booked: 1, available: 1 } }, { $sort: { departure: -1 } }, { $limit: 500 }]);
  const data = rows.map((x) => ({ departure: x.departure, route: x.route, vehicle: x.vehicle, totalSeats: x.total, booked: x.booked, available: x.available, occupancyPercent: x.total ? Math.round((x.booked / x.total) * 100) : 0 }));
  if (req.query.format === 'csv') return sendCsv(res, 'occupancy', data);
  res.json({ success: true, data });
}));

module.exports = r;

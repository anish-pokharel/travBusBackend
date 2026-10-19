const { Router } = require('express');
const { body } = require('express-validator');
const Counter = require('../models/Counter');
const User = require('../models/User');
const CounterStaffAssignment = require('../models/CounterStaffAssignment');
const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const audit = require('../utils/audit');
const { validate } = require('../middleware/validate');
const { authenticate, authorize, requireCounter } = require('../middleware/auth');

const r = Router();
r.use(authenticate);

const NPT = (5 * 60 + 45) * 60 * 1000;
function todayRange() {
  const local = new Date(Date.now() + NPT);
  const start = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - NPT);
  return { start, end: new Date(start.getTime() + 86400000) };
}

// ---- counter staff: own dashboard & daily closing ----
r.get('/me', authorize('counter'), requireCounter, asyncHandler(async (req, res) => res.json({ success: true, data: req.counter })));

async function counterStats(counterId, range, staffId) {
  const match = { counterId, createdAt: { $gte: range.start, $lt: range.end } };
  if (staffId) match.staffId = staffId;
  const [sold, cancelled, cash, byStaff] = await Promise.all([
    Booking.aggregate([{ $match: { ...match, status: 'confirmed' } }, { $group: { _id: null, bookings: { $sum: 1 }, tickets: { $sum: { $size: '$passengers' } }, revenue: { $sum: '$totalAmount' } } }]),
    Booking.aggregate([{ $match: { ...match, status: { $in: ['cancelled', 'refunded'] } } }, { $group: { _id: null, bookings: { $sum: 1 }, amount: { $sum: '$totalAmount' }, refunded: { $sum: '$refundAmount' } } }]),
    Payment.aggregate([{ $match: { counterId, method: 'cash', status: { $in: ['success', 'partially_refunded', 'refunded'] }, paidAt: { $gte: range.start, $lt: range.end }, ...(staffId ? { receivedBy: staffId } : {}) } },
      { $group: { _id: null, amount: { $sum: '$amount' } } }]),
    Booking.aggregate([{ $match: { ...match, status: 'confirmed' } }, { $group: { _id: '$staffId', bookings: { $sum: 1 }, revenue: { $sum: '$totalAmount' } } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'u' } }, { $project: { name: { $arrayElemAt: ['$u.name', 0] }, bookings: 1, revenue: 1 } }]),
  ]);
  return {
    ticketsSold: sold[0]?.tickets || 0, bookings: sold[0]?.bookings || 0, sales: sold[0]?.revenue || 0,
    cashCollected: cash[0]?.amount || 0, cancellations: cancelled[0] || { bookings: 0, amount: 0, refunded: 0 }, byStaff,
  };
}

r.get('/me/dashboard', authorize('counter'), requireCounter, asyncHandler(async (req, res) => {
  const Trip = require('../models/Trip');
  const TripSeatInventory = require('../models/TripSeatInventory');
  const stats = await counterStats(req.counter._id, todayRange());
  const upcoming = await Trip.find({ status: 'scheduled', departureAt: { $gte: new Date(), $lt: new Date(Date.now() + 24 * 3600000) } })
    .populate('vehicleId', 'name registrationNumber').populate('routeId', 'name').sort({ departureAt: 1 }).limit(10).lean();
  const rem = await TripSeatInventory.aggregate([{ $match: { tripId: { $in: upcoming.map((t) => t._id) }, status: 'available' } }, { $group: { _id: '$tripId', n: { $sum: 1 } } }]);
  const rm = new Map(rem.map((x) => [String(x._id), x.n]));
  upcoming.forEach((t) => { t.remainingSeats = rm.get(String(t._id)) || 0; });
  const recent = await Booking.find({ counterId: req.counter._id, status: { $ne: 'held' } }).sort({ createdAt: -1 }).limit(8)
    .select('pnr totalAmount status passengers contact createdAt').lean();
  res.json({ success: true, data: { counter: req.counter, stats, upcoming, recent } });
}));

r.get('/me/daily-closing', authorize('counter'), requireCounter, asyncHandler(async (req, res) => {
  const stats = await counterStats(req.counter._id, todayRange(), req.user._id);
  res.json({ success: true, data: { date: new Date(), counter: req.counter, staff: req.user.toSafe(), ...stats } });
}));

// ---- admin: counter management ----
const rules = [
  body('name').trim().isLength({ min: 2, max: 80 }), body('code').trim().isLength({ min: 2, max: 12 }),
  body('phone').optional({ checkFalsy: true }).matches(/^[0-9+\-\s]{7,20}$/), body('email').optional({ checkFalsy: true }).isEmail(),
];
r.get('/', authorize('admin'), asyncHandler(async (_req, res) => {
  const counters = await Counter.find().sort({ name: 1 }).lean();
  const staff = await User.find({ role: 'counter', isActive: true }, 'name email counterId').lean();
  counters.forEach((c) => { c.staff = staff.filter((s) => String(s.counterId) === String(c._id)); });
  res.json({ success: true, data: counters });
}));
r.post('/', authorize('admin'), validate(rules), asyncHandler(async (req, res) => {
  const c = await Counter.create(req.body);
  await audit(req, 'counter.create', 'Counter', c._id);
  res.status(201).json({ success: true, data: c });
}));
r.patch('/:id', authorize('admin'), asyncHandler(async (req, res) => {
  const { name, code, city, address, phone, email, location, status } = req.body;
  const c = await Counter.findByIdAndUpdate(req.params.id, { $set: JSON.parse(JSON.stringify({ name, code, city, address, phone, email, location, status })) }, { new: true, runValidators: true });
  if (!c) throw ApiError.notFound('Counter not found');
  await audit(req, 'counter.update', 'Counter', c._id);
  res.json({ success: true, data: c });
}));
r.get('/:id/stats', authorize('admin'), asyncHandler(async (req, res) => {
  const mongoose = require('mongoose');
  const id = new mongoose.Types.ObjectId(req.params.id);
  res.json({ success: true, data: await counterStats(id, todayRange()) });
}));
r.post('/:id/staff', authorize('admin'), validate([body('userId').isMongoId()]), asyncHandler(async (req, res) => {
  const user = await User.findById(req.body.userId);
  if (!user || user.role !== 'counter') throw ApiError.badRequest('User must have the counter staff role');
  if (!(await Counter.exists({ _id: req.params.id }))) throw ApiError.notFound('Counter not found');
  await CounterStaffAssignment.updateMany({ userId: user._id }, { $set: { active: false } });
  await CounterStaffAssignment.updateOne({ userId: user._id, counterId: req.params.id }, { $set: { active: true, assignedBy: req.user._id } }, { upsert: true });
  user.counterId = req.params.id;
  user.refreshTokenHash = undefined;
  await user.save();
  await audit(req, 'counter.assign_staff', 'Counter', req.params.id, { userId: user._id });
  res.json({ success: true, message: 'Staff assigned' });
}));

module.exports = r;

const Booking = require('../models/Booking');
const Counter = require('../models/Counter');
const Payment = require('../models/Payment');
const TripSeatInventory = require('../models/TripSeatInventory');
const seatService = require('../services/seatService');
const bookingService = require('../services/bookingService');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const audit = require('../utils/audit');
const { qrCode } = require('../utils/codes');

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NPT = (5 * 60 + 45) * 60 * 1000;

function canAccess(user, b) {
  if (user.role === 'admin') return true;
  if (user.role === 'passenger') return b.userId && String(b.userId) === String(user._id);
  if (user.role === 'counter') return b.counterId && String(b.counterId) === String(user.counterId);
  return false;
}

const populate = [
  { path: 'tripId', populate: [{ path: 'vehicleId', select: 'name registrationNumber operator vehicleType' }, { path: 'routeId', select: 'name departureCity destinationCity stops durationMin' }] },
  { path: 'counterId', select: 'name code city phone address' },
  { path: 'staffId', select: 'name' },
];

const shape = (b) => {
  const o = b.toObject ? b.toObject() : b;
  o.trip = o.tripId; o.tripId = o.trip?._id;
  o.counter = o.counterId; o.counterId = o.counter?._id;
  if (o.pnr) o.qr = qrCode(o.pnr);
  return o;
};

exports.hold = asyncHandler(async (req, res) => {
  const hold = await seatService.holdSeats(req.body.tripId, req.body.seatIds);
  const total = hold.seats.reduce((s, x) => s + x.price, 0);
  res.status(201).json({ success: true, data: {
    reservationId: hold.reservationId, holdExpiresAt: hold.holdExpiresAt, total,
    seats: hold.seats.map((s) => ({ seatId: s.seatId, seatNumber: s.seatNumber, price: s.price })),
  } });
});

exports.release = asyncHandler(async (req, res) => {
  const hasBooking = await Booking.exists({ reservationId: req.body.reservationId, status: 'confirmed' });
  if (!hasBooking) await seatService.releaseReservation(req.body.reservationId);
  res.json({ success: true, message: 'Seats released' });
});

exports.checkout = asyncHandler(async (req, res) => {
  const { reservationId, tripId, passengers, contact, method } = req.body;
  const out = await bookingService.checkoutOnline({ user: req.user, reservationId, tripId, passengers, contact, method });
  await audit(req, 'booking.checkout', 'Booking', out.booking._id, { method });
  res.status(201).json({ success: true, data: { bookingId: out.booking._id, total: out.booking.totalAmount, payment: out.payment, init: out.init } });
});

exports.counterBook = asyncHandler(async (req, res) => {
  let counter = req.counter;
  if (req.user.role === 'admin') {
    counter = await Counter.findById(req.body.counterId);
    if (!counter || counter.status !== 'active') throw ApiError.badRequest('A valid active counterId is required for admin counter bookings');
  }
  const { tripId, seatIds, passengers, contact, paymentMethod } = req.body;
  const ids = seatIds || passengers.map((p) => p.seatId);
  const out = await bookingService.bookAtCounter({ user: req.user, counter, tripId, seatIds: ids, passengers, contact, paymentMethod });
  await audit(req, 'booking.counter_create', 'Booking', out.booking._id, { pnr: out.booking.pnr, total: out.booking.totalAmount });
  const full = await Booking.findById(out.booking._id).populate(populate);
  res.status(201).json({ success: true, data: shape(full) });
});

exports.mine = asyncHandler(async (req, res) => {
  const items = await Booking.find({ userId: req.user._id, status: { $in: ['confirmed', 'cancelled', 'refunded'] } })
    .populate(populate).sort({ createdAt: -1 }).limit(200);
  res.json({ success: true, data: items.map(shape) });
});

exports.list = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(100, parseInt(req.query.limit || '20', 10));
  const q = { status: { $ne: 'held' } };
  if (req.user.role === 'counter') q.counterId = req.user.counterId; // counter-scoped
  else if (req.query.counterId) q.counterId = req.query.counterId;
  if (req.query.status) q.status = req.query.status;
  if (req.query.source) q.source = req.query.source;
  if (req.query.pnr) q.pnr = String(req.query.pnr).toUpperCase();
  if (req.query.phone) q.$or = [{ 'contact.phone': new RegExp(esc(req.query.phone)) }, { 'passengers.phone': new RegExp(esc(req.query.phone)) }];
  if (req.query.name) { const rx = new RegExp(esc(req.query.name), 'i'); (q.$and ||= []).push({ $or: [{ 'passengers.name': rx }, { 'contact.name': rx }] }); }
  if (req.query.from || req.query.to) {
    q.createdAt = {};
    if (req.query.from) q.createdAt.$gte = new Date(req.query.from);
    if (req.query.to) q.createdAt.$lte = new Date(req.query.to);
  }
  let query = Booking.find(q).populate(populate).sort({ createdAt: -1 });
  const [items, total] = await Promise.all([query.skip((page - 1) * limit).limit(limit), Booking.countDocuments(q)]);
  let data = items.map(shape);
  if (req.query.travelDate) { // filter by trip date (Nepal day)
    const s = new Date(new Date(`${req.query.travelDate}T00:00:00Z`).getTime() - NPT);
    data = data.filter((b) => b.trip && new Date(b.trip.departureAt) >= s && new Date(b.trip.departureAt) < new Date(s.getTime() + 86400000));
  }
  res.json({ success: true, data, meta: { page, limit, total } });
});

exports.get = asyncHandler(async (req, res) => {
  const key = req.params.id;
  const b = /^[0-9a-fA-F]{24}$/.test(key) ? await Booking.findById(key).populate(populate) : await Booking.findOne({ pnr: key.toUpperCase() }).populate(populate);
  // 404 (not 403) for other people's bookings so IDs cannot be probed
  if (!b || !canAccess(req.user, b)) throw ApiError.notFound('Booking not found');
  const payment = await Payment.findOne({ bookingId: b._id }).sort({ createdAt: -1 }).lean();
  res.json({ success: true, data: { ...shape(b), payment } });
});

exports.cancel = asyncHandler(async (req, res) => {
  const b = await Booking.findById(req.params.id);
  if (!b || !canAccess(req.user, b)) throw ApiError.notFound('Booking not found');
  const out = await bookingService.cancelBooking({ booking: b, user: req.user, reason: req.body.reason });
  await audit(req, 'booking.cancel', 'Booking', b._id, { refund: out.refund?.amount, percent: out.refundPercent });
  res.json({ success: true, data: { booking: out.booking, refund: out.refund, refundPercent: out.refundPercent } });
});

// duplicate printing is counted & audited
exports.markPrinted = asyncHandler(async (req, res) => {
  const b = await Booking.findById(req.params.id);
  if (!b || !canAccess(req.user, b)) throw ApiError.notFound('Booking not found');
  const duplicate = req.body.original !== true && b.confirmedAt;
  if (duplicate) { b.duplicatePrints += 1; await b.save(); }
  await audit(req, duplicate ? 'ticket.print_duplicate' : 'ticket.print', 'Booking', b._id);
  res.json({ success: true, data: { duplicatePrints: b.duplicatePrints } });
});

module.exports.canAccess = canAccess;
module.exports.shape = shape;
module.exports.populate = populate;

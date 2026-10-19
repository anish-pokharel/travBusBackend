const { Router } = require('express');
const { body } = require('express-validator');
const Payment = require('../models/Payment');
const Booking = require('../models/Booking');
const providers = require('../services/paymentProviders');
const bookingService = require('../services/bookingService');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const audit = require('../utils/audit');
const { validate } = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');

const r = Router();
r.use(authenticate);

async function ownBookingOrFail(req, verified, method) {
  const filter = method === 'khalti' ? { method, providerRef: verified.pidx } : { method, transactionRef: verified.transactionRef };
  const payment = await Payment.findOne(filter);
  if (!payment) throw ApiError.notFound('Payment not found');
  const booking = await Booking.findById(payment.bookingId);
  if (req.user.role !== 'admin' && String(booking.userId) !== String(req.user._id)) throw ApiError.notFound('Payment not found');
}

// The browser redirect only tells us WHERE to look. Success is decided by server-to-gateway verification.
r.post('/esewa/verify', validate([body('data').isString().isLength({ min: 10, max: 4000 })]), asyncHandler(async (req, res) => {
  const verified = await providers.esewa.verify({ data: req.body.data });
  await ownBookingOrFail(req, verified, 'esewa');
  const out = await bookingService.finalizeOnlinePayment('esewa', verified);
  await audit(req, 'payment.esewa_verified', 'Booking', out.booking._id, { duplicate: out.duplicate });
  res.json({ success: true, data: { pnr: out.booking.pnr, bookingId: out.booking._id, duplicate: out.duplicate } });
}));

r.post('/khalti/verify', validate([body('pidx').isString().isLength({ min: 5, max: 100 })]), asyncHandler(async (req, res) => {
  await ownBookingOrFail(req, { pidx: req.body.pidx }, 'khalti');
  const verified = await providers.khalti.verify({ pidx: req.body.pidx });
  const out = await bookingService.finalizeOnlinePayment('khalti', verified);
  await audit(req, 'payment.khalti_verified', 'Booking', out.booking._id, { duplicate: out.duplicate });
  res.json({ success: true, data: { pnr: out.booking.pnr, bookingId: out.booking._id, duplicate: out.duplicate } });
}));

r.get('/', authorize('admin'), asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(100, parseInt(req.query.limit || '20', 10));
  const q = {};
  if (req.query.status) q.status = req.query.status;
  if (req.query.method) q.method = req.query.method;
  const [items, total] = await Promise.all([
    Payment.find(q).populate('bookingId', 'pnr totalAmount status contact').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Payment.countDocuments(q),
  ]);
  res.json({ success: true, data: items, meta: { page, limit, total } });
}));

module.exports = r;

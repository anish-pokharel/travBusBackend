const { Router } = require('express');
const { body } = require('express-validator');
const Refund = require('../models/Refund');
const bookingService = require('../services/bookingService');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const audit = require('../utils/audit');
const { validate } = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');

const r = Router();
r.use(authenticate);

r.get('/', authorize('admin', 'passenger'), asyncHandler(async (req, res) => {
  const q = {};
  if (req.query.status) q.status = req.query.status;
  if (req.user.role === 'passenger') {
    const Booking = require('../models/Booking');
    const ids = await Booking.find({ userId: req.user._id }).distinct('_id');
    q.bookingId = { $in: ids };
  }
  const items = await Refund.find(q).populate('bookingId', 'pnr totalAmount contact').sort({ createdAt: -1 }).limit(200);
  res.json({ success: true, data: items });
}));

r.post('/:id/process', authorize('admin'), validate([body('approve').isBoolean(), body('note').optional().isString().isLength({ max: 300 })]),
  asyncHandler(async (req, res) => {
    const refund = await Refund.findById(req.params.id);
    if (!refund) throw ApiError.notFound('Refund not found');
    const out = await bookingService.processRefund({ refund, user: req.user, approve: req.body.approve, note: req.body.note });
    await audit(req, req.body.approve ? 'refund.complete' : 'refund.reject', 'Refund', refund._id, { amount: refund.amount });
    res.json({ success: true, data: out });
  }));

module.exports = r;

const { Router } = require('express');
const QRCode = require('qrcode');
const { body } = require('express-validator');
const Booking = require('../models/Booking');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const audit = require('../utils/audit');
const { verifySignature, qrCode } = require('../utils/codes');
const { validate } = require('../middleware/validate');
const { authenticate, authorize, requireCounter } = require('../middleware/auth');
const { canAccess, shape, populate } = require('../controllers/bookingController');

const r = Router();
const mask = (s = '') => (s.length <= 4 ? '****' : `${s.slice(0, 2)}${'*'.repeat(s.length - 4)}${s.slice(-2)}`);

function splitCode(code) {
  const [pnr, sig] = String(code || '').trim().toUpperCase().split('.');
  return { pnr, sig: String(code).split('.')[1] };
}

function statusOf(b) {
  if (b.status === 'refunded') return 'refunded';
  if (b.status === 'cancelled') return 'cancelled';
  if (b.status !== 'confirmed') return 'invalid';
  if (b.passengers.length && b.passengers.every((p) => p.checkedIn)) return 'checked_in';
  return 'valid';
}

// Public verification: shows minimal, masked data. Signature must match (blocks PNR guessing).
r.get('/verify/:code', asyncHandler(async (req, res) => {
  const { pnr, sig } = splitCode(req.params.code);
  if (!pnr || !sig || !verifySignature(pnr, sig)) throw ApiError.notFound('Ticket not found or QR code is invalid');
  const b = await Booking.findOne({ pnr }).populate(populate);
  if (!b) throw ApiError.notFound('Ticket not found');
  res.json({ success: true, data: {
    status: statusOf(b), pnr: b.pnr,
    route: b.tripId?.routeId?.name, departureAt: b.tripId?.departureAt,
    vehicle: b.tripId?.vehicleId?.name, registrationNumber: b.tripId?.vehicleId?.registrationNumber,
    passengers: b.passengers.map((p) => ({ name: p.name.split(' ')[0] + ' ' + mask(p.name.split(' ').slice(1).join(' ')), seat: p.seatNumber, checkedIn: p.checkedIn })),
  } });
}));

r.use(authenticate);

// Authorized lookup by PNR for counter staff (no signature needed, they're authenticated)
r.get('/lookup/:pnr', authorize('admin', 'counter'), requireCounter, asyncHandler(async (req, res) => {
  const b = await Booking.findOne({ pnr: String(req.params.pnr).toUpperCase() }).populate(populate);
  if (!b) throw ApiError.notFound('Ticket not found');
  res.json({ success: true, data: { ...shape(b), ticketStatus: statusOf(b) } });
}));

// Counter verification of a scanned QR code: full detail
r.post('/verify', authorize('admin', 'counter'), requireCounter, validate([body('code').isString().isLength({ min: 8, max: 60 })]), asyncHandler(async (req, res) => {
  const { pnr, sig } = splitCode(req.body.code);
  const code = req.body.code.includes('.') ? verifySignature(pnr, sig) : true; // plain PNR typed in is allowed for staff
  if (!pnr || !code) throw ApiError.notFound('Invalid ticket code');
  const b = await Booking.findOne({ pnr }).populate(populate);
  if (!b) throw ApiError.notFound('Ticket not found');
  res.json({ success: true, data: { ...shape(b), ticketStatus: statusOf(b) } });
}));

// Atomic check-in so a ticket cannot be used twice
r.post('/check-in', authorize('admin', 'counter'), requireCounter, validate([body('pnr').isString().isLength({ min: 6, max: 12 })]), asyncHandler(async (req, res) => {
  const pnr = req.body.pnr.toUpperCase();
  const now = new Date();
  const updated = await Booking.findOneAndUpdate(
    { pnr, status: 'confirmed', passengers: { $not: { $elemMatch: { checkedIn: true } } } },
    { $set: { 'passengers.$[].checkedIn': true, 'passengers.$[].checkedInAt': now, 'passengers.$[].checkedInBy': req.user._id } },
    { new: true }
  );
  if (!updated) {
    const b = await Booking.findOne({ pnr });
    if (!b) throw ApiError.notFound('Ticket not found');
    throw ApiError.conflict(`Cannot check in: ticket is ${statusOf(b).replace('_', ' ')}`);
  }
  await audit(req, 'ticket.check_in', 'Booking', updated._id, { pnr });
  res.json({ success: true, message: 'Checked in', data: { pnr, checkedInAt: now } });
}));

// QR image (data URL) for printing
r.get('/:pnr/qr', asyncHandler(async (req, res) => {
  const b = await Booking.findOne({ pnr: String(req.params.pnr).toUpperCase() });
  if (!b || !canAccess(req.user, b)) throw ApiError.notFound('Ticket not found');
  const url = `${require('../config/env').frontendUrl}/verify/${qrCode(b.pnr)}`;
  const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 240, errorCorrectionLevel: 'M' });
  res.json({ success: true, data: { dataUrl, url } });
}));

module.exports = r;

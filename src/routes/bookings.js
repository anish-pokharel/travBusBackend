const { Router } = require('express');
const { body } = require('express-validator');
const c = require('../controllers/bookingController');
const { validate } = require('../middleware/validate');
const { authenticate, authorize, requireCounter } = require('../middleware/auth');

const r = Router();
r.use(authenticate);

const pax = [
  body('passengers').isArray({ min: 1, max: 10 }),
  body('passengers.*.name').trim().isLength({ min: 2, max: 100 }),
  body('passengers.*.phone').optional({ checkFalsy: true }).matches(/^[0-9+\-\s]{7,20}$/),
  body('passengers.*.age').optional({ checkFalsy: true }).isInt({ min: 0, max: 120 }),
  body('passengers.*.gender').optional({ checkFalsy: true }).isIn(['male', 'female', 'other']),
  body('passengers.*.seatId').isString().notEmpty(),
  body('contact.name').trim().isLength({ min: 2, max: 100 }),
  body('contact.phone').matches(/^[0-9+\-\s]{7,20}$/).withMessage('Valid phone is required'),
  body('contact.email').optional({ checkFalsy: true }).isEmail(),
];

r.post('/hold', authorize('passenger', 'admin'), validate([body('tripId').isMongoId(), body('seatIds').isArray({ min: 1, max: 10 })]), c.hold);
r.post('/release', validate([body('reservationId').isUUID()]), c.release);
r.post('/checkout', authorize('passenger', 'admin'), validate([
  body('tripId').isMongoId(), body('reservationId').isUUID(), body('method').isIn(['esewa', 'khalti']), ...pax,
]), c.checkout);

r.post('/counter', authorize('counter', 'admin'), requireCounter, validate([
  body('tripId').isMongoId(), body('paymentMethod').optional().isIn(['cash', 'other']), ...pax,
]), c.counterBook);

r.get('/mine', authorize('passenger', 'admin'), c.mine);
r.get('/', authorize('admin', 'counter'), requireCounter, c.list);
r.get('/:id', c.get);
r.post('/:id/cancel', validate([body('reason').optional().isString().isLength({ max: 300 })]), c.cancel);
r.post('/:id/printed', authorize('admin', 'counter'), c.markPrinted);

module.exports = r;

const { Router } = require('express');
const { body } = require('express-validator');
const Vehicle = require('../models/Vehicle');
const c = require('../controllers/vehicleController');
const { validate } = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');

const r = Router();
r.use(authenticate, authorize('admin'));

r.get('/types', (_req, res) => res.json({ success: true, data: Vehicle.VEHICLE_TYPES }));
r.get('/', c.list);
r.get('/:id', c.get);
r.post('/', validate([
  body('name').trim().isLength({ min: 2, max: 100 }),
  body('registrationNumber').trim().isLength({ min: 3, max: 30 }),
  body('operator').trim().isLength({ min: 2, max: 100 }),
  body('vehicleType').isIn(Vehicle.VEHICLE_TYPES),
  body('layoutId').optional({ checkFalsy: true }).isMongoId(),
  body('amenities').optional().isArray({ max: 30 }),
]), c.create);
r.patch('/:id', validate([
  body('vehicleType').optional().isIn(Vehicle.VEHICLE_TYPES),
  body('layoutId').optional({ checkFalsy: true }).isMongoId(),
  body('status').optional().isIn(['active', 'inactive']),
]), c.update);
r.patch('/:id/status', validate([body('status').isIn(['active', 'inactive'])]), c.setStatus);

module.exports = r;

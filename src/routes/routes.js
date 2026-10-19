const { Router } = require('express');
const { body } = require('express-validator');
const c = require('../controllers/routeController');
const { validate } = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');

const r = Router();
r.get('/cities', c.cities); // public

const rules = [
  body('departureCity').trim().isLength({ min: 2, max: 60 }),
  body('destinationCity').trim().isLength({ min: 2, max: 60 }),
  body('durationMin').isInt({ min: 1, max: 4000 }),
  body('distanceKm').optional().isFloat({ min: 0, max: 5000 }),
  body('stops').optional().isArray({ max: 30 }),
];
r.get('/', c.list); // public: route list is not sensitive
r.get('/:id', c.get);
r.post('/', authenticate, authorize('admin'), validate(rules), c.create);
r.patch('/:id', authenticate, authorize('admin'), c.update);
r.delete('/:id', authenticate, authorize('admin'), c.remove);

module.exports = r;

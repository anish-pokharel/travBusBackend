const { Router } = require('express');
const { body } = require('express-validator');
const c = require('../controllers/layoutController');
const { validate } = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');

const r = Router();
r.use(authenticate);
// read access for admin only; passengers/counter get layouts via /api/seats/trip/:id
r.use(authorize('admin'));

const rules = [
  body('name').trim().isLength({ min: 2, max: 80 }),
  body('vehicleType').isString().notEmpty(),
  body('rows').isInt({ min: 1, max: 60 }),
  body('columns').isInt({ min: 1, max: 12 }),
  body('seats').isArray({ max: 400 }),
  body('elements').optional().isArray({ max: 400 }),
];

r.get('/templates', c.templates);
r.get('/templates/:key', c.buildTemplate);
r.post('/validate', c.validate);
r.get('/', c.list);
r.get('/:id', c.get);
r.post('/', validate(rules), c.create);
r.put('/:id', validate(rules), c.update);
r.post('/:id/duplicate', c.duplicate);
r.delete('/:id', c.archive);

module.exports = r;

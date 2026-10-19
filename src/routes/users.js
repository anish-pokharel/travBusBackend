const { Router } = require('express');
const { body } = require('express-validator');
const c = require('../controllers/userController');
const { validate } = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');

const r = Router();
r.use(authenticate, authorize('admin'));

const pw = body('password').isLength({ min: 8, max: 72 }).matches(/[A-Za-z]/).matches(/\d/);
r.get('/', c.list);
r.post('/', validate([
  body('name').trim().isLength({ min: 2, max: 100 }), body('email').isEmail().normalizeEmail(),
  body('phone').optional({ checkFalsy: true }).matches(/^[0-9+\-\s]{7,20}$/), pw,
  body('role').isIn(['admin', 'passenger', 'counter']), body('counterId').optional({ checkFalsy: true }).isMongoId(),
]), c.create);
r.patch('/:id', validate([
  body('name').optional().trim().isLength({ min: 2, max: 100 }),
  body('role').optional().isIn(['admin', 'passenger', 'counter']),
  body('isActive').optional().isBoolean(),
  body('counterId').optional({ checkFalsy: true }).isMongoId(),
  body('password').optional({ checkFalsy: true }).isLength({ min: 8, max: 72 }),
]), c.update);
r.delete('/:id', c.remove);

module.exports = r;

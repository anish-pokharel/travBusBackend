const { Router } = require('express');
const { body } = require('express-validator');
const c = require('../controllers/authController');
const { validate } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');

const r = Router();
const strongPassword = (f) => body(f).isLength({ min: 8, max: 72 }).withMessage('Password must be 8-72 characters')
  .matches(/[A-Za-z]/).withMessage('Password needs a letter').matches(/\d/).withMessage('Password needs a number');

r.post('/register', validate([
  body('name').trim().isLength({ min: 2, max: 100 }),
  body('email').isEmail().normalizeEmail(),
  body('phone').optional({ checkFalsy: true }).matches(/^[0-9+\-\s]{7,20}$/).withMessage('Invalid phone'),
  strongPassword('password'),
]), c.register);
r.post('/login', validate([body('email').isEmail().normalizeEmail(), body('password').isString().notEmpty()]), c.login);
r.post('/refresh', c.refresh);
r.post('/logout', c.logout);
r.get('/me', authenticate, c.me);
r.patch('/profile', authenticate, validate([
  body('name').optional().trim().isLength({ min: 2, max: 100 }),
  body('phone').optional({ checkFalsy: true }).matches(/^[0-9+\-\s]{7,20}$/),
]), c.updateProfile);
r.post('/change-password', authenticate, validate([body('currentPassword').notEmpty(), strongPassword('newPassword')]), c.changePassword);
r.post('/forgot-password', validate([body('email').isEmail().normalizeEmail()]), c.forgotPassword);
r.post('/reset-password', validate([body('token').isString().isLength({ min: 32, max: 128 }), strongPassword('password')]), c.resetPassword);

module.exports = r;

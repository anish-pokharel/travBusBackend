const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Notification = require('../models/Notification');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const audit = require('../utils/audit');
const cfg = require('../config/env');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

const cookieOpts = () => ({
  httpOnly: true,
  secure: cfg.isProd || cfg.cookieSecure,
  sameSite: cfg.cookieSameSite,
  path: '/api/auth',
  maxAge: cfg.refreshDays * 24 * 3600 * 1000,
});

function signAccess(user) {
  return jwt.sign({ sub: String(user._id), role: user.role }, cfg.jwtAccessSecret, { expiresIn: cfg.accessTtl });
}

async function issueTokens(user, res) {
  const refresh = jwt.sign({ sub: String(user._id), jti: crypto.randomUUID() }, cfg.jwtRefreshSecret, { expiresIn: `${cfg.refreshDays}d` });
  await User.updateOne({ _id: user._id }, { $set: { refreshTokenHash: sha(refresh), lastLoginAt: new Date() } });
  res.cookie('refresh_token', refresh, cookieOpts());
  return signAccess(user);
}

exports.register = asyncHandler(async (req, res) => {
  const { name, email, phone, password } = req.body;
  // Public registration always creates a passenger. Role is never read from the body.
  const user = await User.create({ name, email, phone, password, role: 'passenger' });
  const token = await issueTokens(user, res);
  await audit(req, 'auth.register', 'User', user._id);
  res.status(201).json({ success: true, data: { user: user.toSafe(), accessToken: token } });
});

exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email: String(email).toLowerCase() }).select('+password');
  // same message for unknown user / wrong password
  if (!user || !(await user.comparePassword(password))) throw ApiError.unauthorized('Invalid email or password');
  if (!user.isActive) throw ApiError.forbidden('Your account has been disabled');
  const token = await issueTokens(user, res);
  await audit({ user, ip: req.ip }, 'auth.login', 'User', user._id);
  res.json({ success: true, data: { user: user.toSafe(), accessToken: token } });
});

exports.refresh = asyncHandler(async (req, res) => {
  const cookie = req.cookies?.refresh_token;
  if (!cookie) throw ApiError.unauthorized('No session');
  let payload;
  try { payload = jwt.verify(cookie, cfg.jwtRefreshSecret); } catch { throw ApiError.unauthorized('Session expired'); }
  const user = await User.findById(payload.sub).select('+refreshTokenHash');
  if (!user || !user.isActive || user.refreshTokenHash !== sha(cookie)) {
    if (user) await User.updateOne({ _id: user._id }, { $unset: { refreshTokenHash: 1 } }); // reuse detected
    throw ApiError.unauthorized('Session invalid');
  }
  const token = await issueTokens(user, res); // rotation
  res.json({ success: true, data: { user: user.toSafe(), accessToken: token } });
});

exports.logout = asyncHandler(async (req, res) => {
  const cookie = req.cookies?.refresh_token;
  if (cookie) {
    try {
      const p = jwt.verify(cookie, cfg.jwtRefreshSecret);
      await User.updateOne({ _id: p.sub }, { $unset: { refreshTokenHash: 1 } });
    } catch { /* ignore */ }
  }
  res.clearCookie('refresh_token', { ...cookieOpts(), maxAge: undefined });
  res.json({ success: true, message: 'Logged out' });
});

exports.me = asyncHandler(async (req, res) => res.json({ success: true, data: req.user.toSafe() }));

exports.updateProfile = asyncHandler(async (req, res) => {
  const { name, phone } = req.body; // email/role cannot be changed here
  if (name !== undefined) req.user.name = name;
  if (phone !== undefined) req.user.phone = phone;
  await req.user.save();
  res.json({ success: true, data: req.user.toSafe() });
});

exports.changePassword = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('+password');
  if (!(await user.comparePassword(req.body.currentPassword))) throw ApiError.badRequest('Current password is incorrect');
  user.password = req.body.newPassword;
  user.refreshTokenHash = undefined;
  await user.save();
  await audit(req, 'auth.password_change', 'User', user._id);
  res.json({ success: true, message: 'Password updated. Please log in again.' });
});

exports.forgotPassword = asyncHandler(async (req, res) => {
  const user = await User.findOne({ email: String(req.body.email).toLowerCase() });
  let devToken;
  if (user && user.isActive) {
    const token = crypto.randomBytes(32).toString('hex');
    await User.updateOne({ _id: user._id }, { $set: { resetTokenHash: sha(token), resetExpires: new Date(Date.now() + 30 * 60 * 1000) } });
    const link = `${cfg.frontendUrl}/reset-password?token=${token}`;
    // TODO(production): send `link` with your email provider (SMTP/SES/SendGrid). Logged only outside production.
    if (!cfg.isProd) { console.log(`[dev] password reset link for ${user.email}: ${link}`); devToken = token; }
    await Notification.create({ userId: user._id, title: 'Password reset requested', message: 'A password reset was requested for your account.', type: 'security' });
  }
  // identical response whether or not the account exists
  res.json({ success: true, message: 'If that email is registered, a reset link has been sent.', ...(devToken ? { devToken } : {}) });
});

exports.resetPassword = asyncHandler(async (req, res) => {
  const user = await User.findOne({ resetTokenHash: sha(req.body.token), resetExpires: { $gt: new Date() } }).select('+resetTokenHash +resetExpires');
  if (!user) throw ApiError.badRequest('Reset link is invalid or has expired');
  user.password = req.body.password;
  user.resetTokenHash = undefined;
  user.resetExpires = undefined;
  user.refreshTokenHash = undefined;
  await user.save();
  await audit({ user, ip: req.ip }, 'auth.password_reset', 'User', user._id);
  res.json({ success: true, message: 'Password reset. You can now log in.' });
});

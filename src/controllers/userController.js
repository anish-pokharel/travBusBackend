const User = require('../models/User');
const Counter = require('../models/Counter');
const CounterStaffAssignment = require('../models/CounterStaffAssignment');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const audit = require('../utils/audit');

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

exports.list = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(100, parseInt(req.query.limit || '20', 10));
  const q = {};
  if (req.query.role && ['admin', 'passenger', 'counter'].includes(req.query.role)) q.role = req.query.role;
  if (req.query.search) {
    const rx = new RegExp(esc(req.query.search), 'i');
    q.$or = [{ name: rx }, { email: rx }, { phone: rx }];
  }
  const [items, total] = await Promise.all([
    User.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate('counterId', 'name code'),
    User.countDocuments(q),
  ]);
  res.json({ success: true, data: items.map((u) => ({ ...u.toSafe(), counter: u.counterId })), meta: { page, limit, total } });
});

exports.create = asyncHandler(async (req, res) => {
  const { name, email, phone, password, role, counterId } = req.body;
  if (role === 'counter') {
    if (!counterId || !(await Counter.exists({ _id: counterId }))) throw ApiError.badRequest('A valid counter is required for counter staff');
  }
  const user = await User.create({ name, email, phone, password, role, counterId: role === 'counter' ? counterId : null });
  if (role === 'counter') await CounterStaffAssignment.create({ counterId, userId: user._id, assignedBy: req.user._id });
  await audit(req, 'user.create', 'User', user._id, { role, email });
  res.status(201).json({ success: true, data: user.toSafe() });
});

exports.update = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found');
  const { name, phone, role, isActive, counterId, password } = req.body;
  if (String(user._id) === String(req.user._id) && (isActive === false || (role && role !== 'admin'))) {
    throw ApiError.badRequest('You cannot deactivate or demote your own account');
  }
  if (name !== undefined) user.name = name;
  if (phone !== undefined) user.phone = phone;
  if (isActive !== undefined) user.isActive = isActive;
  if (password) user.password = password;
  if (role) user.role = role;
  if (user.role === 'counter') {
    const cid = counterId || user.counterId;
    if (!cid || !(await Counter.exists({ _id: cid }))) throw ApiError.badRequest('A valid counter is required for counter staff');
    user.counterId = cid;
    await CounterStaffAssignment.updateMany({ userId: user._id, counterId: { $ne: cid } }, { $set: { active: false } });
    await CounterStaffAssignment.updateOne({ userId: user._id, counterId: cid }, { $set: { active: true, assignedBy: req.user._id } }, { upsert: true });
  } else {
    user.counterId = null;
    await CounterStaffAssignment.updateMany({ userId: user._id }, { $set: { active: false } });
  }
  if (isActive === false || password) user.refreshTokenHash = undefined; // force re-login
  await user.save();
  await audit(req, 'user.update', 'User', user._id, { role: user.role, isActive: user.isActive });
  res.json({ success: true, data: user.toSafe() });
});

exports.remove = asyncHandler(async (req, res) => {
  if (String(req.params.id) === String(req.user._id)) throw ApiError.badRequest('You cannot delete your own account');
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found');
  // soft delete keeps booking history intact
  user.isActive = false;
  user.refreshTokenHash = undefined;
  await user.save();
  await audit(req, 'user.deactivate', 'User', user._id);
  res.json({ success: true, message: 'User deactivated' });
});

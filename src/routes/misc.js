const { Router } = require('express');
const { body } = require('express-validator');
const Notification = require('../models/Notification');
const AuditLog = require('../models/AuditLog');
const Setting = require('../models/Setting');
const asyncHandler = require('../utils/asyncHandler');
const audit = require('../utils/audit');
const ApiError = require('../utils/ApiError');
const { validate } = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');

const notifications = Router();
notifications.use(authenticate);
notifications.get('/', asyncHandler(async (req, res) => {
  const items = await Notification.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(50);
  res.json({ success: true, data: items, unread: items.filter((n) => !n.read).length });
}));
notifications.patch('/read-all', asyncHandler(async (req, res) => {
  await Notification.updateMany({ userId: req.user._id, read: false }, { $set: { read: true } });
  res.json({ success: true });
}));
notifications.patch('/:id/read', asyncHandler(async (req, res) => {
  await Notification.updateOne({ _id: req.params.id, userId: req.user._id }, { $set: { read: true } });
  res.json({ success: true });
}));

const auditLogs = Router();
auditLogs.use(authenticate, authorize('admin'));
auditLogs.get('/', asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(100, parseInt(req.query.limit || '30', 10));
  const q = {};
  if (req.query.action) q.action = new RegExp(`^${String(req.query.action).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  if (req.query.entity) q.entity = String(req.query.entity);
  const [items, total] = await Promise.all([
    AuditLog.find(q).populate('actorId', 'name email').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    AuditLog.countDocuments(q),
  ]);
  res.json({ success: true, data: items, meta: { page, limit, total } });
}));

const settings = Router();
settings.get('/public', asyncHandler(async (_req, res) => {
  const s = await Setting.getAll();
  res.json({ success: true, data: { cancellationPolicy: s.cancellationPolicy, holdMinutes: s.holdMinutes } });
}));
settings.use(authenticate, authorize('admin'));
settings.get('/', asyncHandler(async (_req, res) => res.json({ success: true, data: await Setting.getAll() })));
settings.put('/', validate([
  body('cancellationPolicy').optional().isArray({ min: 1, max: 10 }),
  body('cancellationPolicy.*.hoursBefore').optional().isFloat({ min: 0, max: 720 }),
  body('cancellationPolicy.*.refundPercent').optional().isFloat({ min: 0, max: 100 }),
  body('holdMinutes').optional().isInt({ min: 2, max: 60 }),
  body('releaseSeatsOnCancel').optional().isBoolean(),
  body('allowOnlineCancellation').optional().isBoolean(),
]), asyncHandler(async (req, res) => {
  const allowed = ['cancellationPolicy', 'holdMinutes', 'releaseSeatsOnCancel', 'allowOnlineCancellation'];
  for (const k of allowed) {
    if (req.body[k] !== undefined) await Setting.updateOne({ key: k }, { $set: { value: req.body[k] } }, { upsert: true });
  }
  await audit(req, 'settings.update', 'Setting', 'global', req.body);
  res.json({ success: true, data: await Setting.getAll() });
}));

module.exports = { notifications, auditLogs, settings };

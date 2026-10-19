const AuditLog = require('../models/AuditLog');

/** Fire-and-forget audit record. Never throws into the request path. */
module.exports = async function audit(req, action, entity, entityId, details) {
  try {
    await AuditLog.create({
      actorId: req?.user?._id,
      actorRole: req?.user?.role || 'system',
      action,
      entity,
      entityId: entityId ? String(entityId) : undefined,
      details,
      ip: req?.ip,
    });
  } catch (e) {
    console.error('Audit log failed:', e.message);
  }
};

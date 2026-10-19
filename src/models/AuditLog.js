const mongoose = require('mongoose');

const auditSchema = new mongoose.Schema(
  {
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    actorRole: String,
    action: { type: String, required: true, index: true },
    entity: { type: String, index: true },
    entityId: String,
    details: mongoose.Schema.Types.Mixed,
    ip: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
auditSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditSchema);

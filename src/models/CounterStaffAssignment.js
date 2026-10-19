const mongoose = require('mongoose');

const assignmentSchema = new mongoose.Schema(
  {
    counterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Counter', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    active: { type: Boolean, default: true },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
assignmentSchema.index({ counterId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('CounterStaffAssignment', assignmentSchema);

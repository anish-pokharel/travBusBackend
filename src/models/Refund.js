const mongoose = require('mongoose');

const refundSchema = new mongoose.Schema(
  {
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', required: true },
    amount: { type: Number, required: true, min: 0 },
    percent: { type: Number, min: 0, max: 100 },
    reason: String,
    status: { type: String, enum: ['pending', 'completed', 'rejected'], default: 'pending', index: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    processedAt: Date,
    note: String,
  },
  { timestamps: true }
);

module.exports = mongoose.model('Refund', refundSchema);

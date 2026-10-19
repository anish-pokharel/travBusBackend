const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
    method: { type: String, enum: ['cash', 'esewa', 'khalti', 'other'], required: true },
    amount: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ['pending', 'success', 'failed', 'refunded', 'partially_refunded'], default: 'pending', index: true },
    transactionRef: { type: String }, // our uuid sent to the gateway
    providerRef: { type: String },                  // gateway transaction code / pidx
    refundedAmount: { type: Number, default: 0 },
    paidAt: Date,
    receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    counterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Counter' },
    raw: { type: mongoose.Schema.Types.Mixed, select: false },
  },
  { timestamps: true }
);

// a gateway reference can only be recorded once -> idempotent callbacks
paymentSchema.index({ method: 1, providerRef: 1 }, { unique: true, partialFilterExpression: { providerRef: { $type: 'string' } } });
paymentSchema.index({ transactionRef: 1 }, { unique: true, partialFilterExpression: { transactionRef: { $type: 'string' } } });

module.exports = mongoose.model('Payment', paymentSchema);

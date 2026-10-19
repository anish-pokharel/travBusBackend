const mongoose = require('mongoose');

const passengerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    phone: { type: String, trim: true, maxlength: 20 },
    age: { type: Number, min: 0, max: 120 },
    gender: { type: String, enum: ['male', 'female', 'other', ''], default: '' },
    seatId: { type: String, required: true },
    seatNumber: { type: String, required: true },
    price: { type: Number, required: true },
    ticketNo: { type: String },
    checkedIn: { type: Boolean, default: false },
    checkedInAt: Date,
    checkedInBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false }
);

const bookingSchema = new mongoose.Schema(
  {
    pnr: { type: String, unique: true, sparse: true, index: true },
    tripId: { type: mongoose.Schema.Types.ObjectId, ref: 'Trip', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    source: { type: String, enum: ['online', 'counter'], required: true, index: true },
    counterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Counter', index: true },
    staffId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    contact: { name: String, phone: String, email: String },
    passengers: [passengerSchema],
    reservationId: { type: String, required: true, index: true },
    holdExpiresAt: Date,
    totalAmount: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ['held', 'confirmed', 'cancelled', 'expired', 'refunded'], default: 'held', index: true },
    paymentStatus: { type: String, enum: ['unpaid', 'pending', 'paid', 'failed', 'refunded', 'partially_refunded'], default: 'unpaid' },
    paymentMethod: { type: String, enum: ['cash', 'esewa', 'khalti', 'other', null], default: null },
    confirmedAt: Date,
    cancelledAt: Date,
    cancelReason: String,
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    refundAmount: { type: Number, default: 0 },
    duplicatePrints: { type: Number, default: 0 },
  },
  { timestamps: true }
);

bookingSchema.index({ 'contact.phone': 1 });
bookingSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Booking', bookingSchema);

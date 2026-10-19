const mongoose = require('mongoose');

/**
 * One document per (trip, seat). The unique index is the final guard
 * against double booking; state transitions are done with atomic
 * conditional updates (see seatService).
 */
const inventorySchema = new mongoose.Schema(
  {
    tripId: { type: mongoose.Schema.Types.ObjectId, ref: 'Trip', required: true },
    seatId: { type: String, required: true },
    seatNumber: { type: String, required: true },
    category: String,
    status: { type: String, enum: ['available', 'held', 'booked', 'blocked'], default: 'available' },
    reservationId: { type: String, default: null },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', default: null },
    holdExpiresAt: { type: Date, default: null },
    price: { type: Number, required: true, min: 0 },
  },
  { timestamps: true }
);

inventorySchema.index({ tripId: 1, seatId: 1 }, { unique: true });
inventorySchema.index({ tripId: 1, status: 1 });
inventorySchema.index({ reservationId: 1 });
inventorySchema.index({ status: 1, holdExpiresAt: 1 });

module.exports = mongoose.model('TripSeatInventory', inventorySchema);

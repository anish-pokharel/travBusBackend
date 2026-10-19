const mongoose = require('mongoose');

const tripSchema = new mongoose.Schema(
  {
    vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', required: true, index: true },
    routeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Route', required: true, index: true },
    layoutId: { type: mongoose.Schema.Types.ObjectId, ref: 'VehicleLayout', required: true }, // pinned layout version
    travelDate: { type: Date, required: true, index: true }, // midnight Nepal time stored as UTC instant
    departureAt: { type: Date, required: true, index: true },
    arrivalAt: { type: Date, required: true },
    fare: {
      base: { type: Number, required: true, min: 0 },
      categoryPrices: { type: Map, of: Number, default: {} }, // pricingCategory -> price
    },
    status: { type: String, enum: ['scheduled', 'boarding', 'departed', 'completed', 'cancelled'], default: 'scheduled', index: true },
    bookingOpen: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

tripSchema.index({ vehicleId: 1, departureAt: 1, arrivalAt: 1 });

module.exports = mongoose.model('Trip', tripSchema);

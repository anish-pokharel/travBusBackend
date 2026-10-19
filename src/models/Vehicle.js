const mongoose = require('mongoose');

const VEHICLE_TYPES = ['bus', 'tourist_bus', 'local_bus', 'deluxe_bus', 'sleeper_bus', 'hiace', 'microbus',
  'coaster', 'van', 'car', 'taxi', 'suv', 'custom'];

const vehicleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    registrationNumber: { type: String, required: true, unique: true, uppercase: true, trim: true },
    operator: { type: String, required: true, trim: true },
    vehicleType: { type: String, enum: VEHICLE_TYPES, required: true, index: true },
    seatCapacity: { type: Number, default: 0 }, // derived from layout
    layoutId: { type: mongoose.Schema.Types.ObjectId, ref: 'VehicleLayout' },
    amenities: [{ type: String, trim: true }],
    info: { type: String, maxlength: 1000 },
    status: { type: String, enum: ['active', 'inactive'], default: 'active', index: true },
  },
  { timestamps: true }
);

vehicleSchema.statics.VEHICLE_TYPES = VEHICLE_TYPES;
module.exports = mongoose.model('Vehicle', vehicleSchema);

const mongoose = require('mongoose');

const stopSchema = new mongoose.Schema(
  {
    city: { type: String, required: true, trim: true },
    sequence: { type: Number, required: true, min: 0 },
    arrivalOffsetMin: { type: Number, default: 0, min: 0 },   // minutes after departure
    departureOffsetMin: { type: Number, default: 0, min: 0 },
    distanceFromStartKm: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const routeSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true },
    departureCity: { type: String, required: true, trim: true, index: true },
    destinationCity: { type: String, required: true, trim: true, index: true },
    stops: [stopSchema], // intermediate stops only
    distanceKm: { type: Number, min: 0, default: 0 },
    durationMin: { type: Number, min: 1, required: true },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  },
  { timestamps: true }
);

routeSchema.pre('validate', function (next) {
  if (!this.name) this.name = `${this.departureCity} - ${this.destinationCity}`;
  next();
});

module.exports = mongoose.model('Route', routeSchema);

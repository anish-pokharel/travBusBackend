const mongoose = require('mongoose');

const seatSchema = new mongoose.Schema(
  {
    seatId: { type: String, required: true },
    seatNumber: { type: String, required: true },
    row: { type: Number, required: true, min: 0 },
    col: { type: Number, required: true, min: 0 },
    x: Number,
    y: Number,
    kind: { type: String, enum: ['seat', 'berth'], default: 'seat' },
    category: {
      type: String,
      enum: ['regular', 'premium', 'vip', 'window', 'aisle', 'upper_sleeper', 'lower_sleeper', 'custom'],
      default: 'regular',
    },
    pricingCategory: { type: String, default: 'regular' },
    active: { type: Boolean, default: true },
    bookable: { type: Boolean, default: true },
    position: { type: String, enum: ['window', 'aisle', 'middle', 'none'], default: 'none' },
    accessible: { type: Boolean, default: false },
    restrictions: { type: String, maxlength: 200 },
    rotation: { type: Number, default: 0 },
    metadata: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false }
);

const ELEMENT_TYPES = ['driver', 'empty', 'aisle', 'front_door', 'rear_door', 'side_door', 'emergency_exit',
  'luggage', 'restricted', 'staff', 'label'];

const elementSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    type: { type: String, enum: ELEMENT_TYPES, required: true },
    row: { type: Number, required: true, min: 0 },
    col: { type: Number, required: true, min: 0 },
    rowSpan: { type: Number, default: 1, min: 1 },
    colSpan: { type: Number, default: 1, min: 1 },
    label: { type: String, maxlength: 40 },
    rotation: { type: Number, default: 0 },
  },
  { _id: false }
);

const layoutSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    layoutKey: { type: String, required: true, index: true }, // shared across versions
    version: { type: Number, default: 1 },
    vehicleType: { type: String, required: true },
    rows: { type: Number, required: true, min: 1, max: 60 },
    columns: { type: Number, required: true, min: 1, max: 12 },
    dimensions: { cellWidth: { type: Number, default: 48 }, cellHeight: { type: Number, default: 48 }, gap: { type: Number, default: 6 } },
    aisleWidth: { type: Number, default: 1 },
    seats: [seatSchema],
    elements: [elementSchema],
    totalSeats: { type: Number, default: 0 },
    bookableSeats: { type: Number, default: 0 },
    isTemplate: { type: Boolean, default: false },
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

layoutSchema.index({ layoutKey: 1, version: 1 }, { unique: true });

layoutSchema.pre('save', function (next) {
  this.totalSeats = this.seats.length;
  this.bookableSeats = this.seats.filter((s) => s.bookable && s.active).length;
  next();
});

layoutSchema.statics.ELEMENT_TYPES = ELEMENT_TYPES;
module.exports = mongoose.model('VehicleLayout', layoutSchema);

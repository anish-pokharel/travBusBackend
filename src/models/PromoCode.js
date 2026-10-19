const mongoose = require('mongoose');

const promoSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    discountType: { type: String, enum: ['percent', 'flat'], required: true },
    value: { type: Number, required: true, min: 0 },
    maxDiscount: Number,
    validFrom: Date,
    validTo: Date,
    usageLimit: { type: Number, default: 0 },
    used: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PromoCode', promoSchema);

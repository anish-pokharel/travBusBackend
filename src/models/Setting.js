const mongoose = require('mongoose');

const settingSchema = new mongoose.Schema(
  { key: { type: String, unique: true, required: true }, value: mongoose.Schema.Types.Mixed },
  { timestamps: true }
);

const Setting = mongoose.model('Setting', settingSchema);

const DEFAULTS = {
  cancellationPolicy: [
    { hoursBefore: 48, refundPercent: 90 },
    { hoursBefore: 24, refundPercent: 70 },
    { hoursBefore: 6, refundPercent: 50 },
    { hoursBefore: 0, refundPercent: 0 },
  ],
  holdMinutes: 10,
  releaseSeatsOnCancel: true,
  allowOnlineCancellation: true,
};

Setting.getAll = async () => {
  const rows = await Setting.find().lean();
  const out = { ...DEFAULTS };
  rows.forEach((r) => (out[r.key] = r.value));
  return out;
};

Setting.DEFAULTS = DEFAULTS;
module.exports = Setting;

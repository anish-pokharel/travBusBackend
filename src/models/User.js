const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, trim: true, maxlength: 20 },
    password: { type: String, required: true, select: false, minlength: 8 },
    role: { type: String, enum: ['admin', 'passenger', 'counter'], default: 'passenger', index: true },
    counterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Counter', default: null },
    isActive: { type: Boolean, default: true },
    refreshTokenHash: { type: String, select: false },
    resetTokenHash: { type: String, select: false },
    resetExpires: { type: Date, select: false },
    lastLoginAt: Date,
  },
  { timestamps: true }
);

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

userSchema.methods.toSafe = function () {
  return {
    id: this._id, name: this.name, email: this.email, phone: this.phone,
    role: this.role, counterId: this.counterId, isActive: this.isActive,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('User', userSchema);

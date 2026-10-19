const mongoose = require('mongoose');
const { mongoUri } = require('./env');

mongoose.set('strictQuery', true);
mongoose.set('sanitizeFilter', false);

module.exports = async function connectDB() {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 15000 });
  console.log(`MongoDB connected: ${mongoose.connection.name}`);
};

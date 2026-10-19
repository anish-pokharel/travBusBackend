const cfg = require('./config/env');
const connectDB = require('./config/db');
const app = require('./app');
const startJobs = require('./jobs/holdExpiry');
const mongoose = require('mongoose');

(async () => {
  await connectDB();
  // make sure unique/compound indexes (double-booking guard) exist before taking traffic
  await mongoose.syncIndexes?.().catch((e) => console.warn('syncIndexes warning:', e.message));
  startJobs();
  const server = app.listen(cfg.port, () => console.log(`API listening on :${cfg.port} (${cfg.env})`));

  const shutdown = (sig) => {
    console.log(`${sig} received, shutting down`);
    server.close(() => mongoose.connection.close(false).then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
})().catch((e) => {
  console.error('Failed to start:', e.message);
  process.exit(1);
});

process.on('unhandledRejection', (e) => console.error('Unhandled rejection:', e));

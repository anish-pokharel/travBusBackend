const cron = require('node-cron');
const seatService = require('../services/seatService');
const bookingService = require('../services/bookingService');

/** Every minute: expire stale unpaid bookings first, then release remaining expired seat holds. */
module.exports = function startJobs() {
  cron.schedule('* * * * *', async () => {
    try {
      const b = await bookingService.expireStaleBookings();
      const s = await seatService.expireHolds();
      if (b || s) console.log(`[jobs] expired bookings: ${b}, released holds: ${s}`);
    } catch (e) {
      console.error('[jobs] hold expiry failed:', e.message);
    }
  });
};

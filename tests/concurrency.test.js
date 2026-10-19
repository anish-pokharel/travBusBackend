/**
 * Integration test for the double-booking guard. Runs against a REAL MongoDB.
 * Use a throwaway database, NEVER production:
 *   TEST_MONGODB_URI="mongodb+srv://.../Bus_Lam_test" npm test
 * Skipped automatically when TEST_MONGODB_URI is not set.
 */
const test = require('node:test');
const assert = require('node:assert');

const uri = process.env.TEST_MONGODB_URI;
const skip = !uri && 'TEST_MONGODB_URI not set';

test('concurrent holds: only one request wins each seat; expired holds are reusable', { skip }, async () => {
  process.env.MONGODB_URI = uri;
  process.env.JWT_ACCESS_SECRET = 'x'.repeat(40); process.env.JWT_REFRESH_SECRET = 'y'.repeat(40); process.env.TICKET_SECRET = 'z'.repeat(40);
  const mongoose = require('mongoose');
  await mongoose.connect(uri);
  const Trip = require('../src/models/Trip');
  const Inv = require('../src/models/TripSeatInventory');
  const seats = require('../src/services/seatService');
  await Inv.init();

  const tripId = new mongoose.Types.ObjectId();
  await Trip.create({ _id: tripId, vehicleId: new mongoose.Types.ObjectId(), routeId: new mongoose.Types.ObjectId(), layoutId: new mongoose.Types.ObjectId(),
    travelDate: new Date(), departureAt: new Date(Date.now() + 86400000), arrivalAt: new Date(Date.now() + 90000000), fare: { base: 100 } });
  await Inv.insertMany(['A1', 'A2', 'A3'].map((n) => ({ tripId, seatId: n, seatNumber: n, price: 100 })));

  try {
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => seats.holdSeats(tripId, ['A1', 'A2'])));
    assert.strictEqual(results.filter((r) => r.status === 'fulfilled').length, 1, 'exactly one request may hold A1+A2');
    const held = await Inv.countDocuments({ tripId, status: 'held' });
    assert.strictEqual(held, 2, 'failed requests must roll back their partial holds');

    // a booking cannot be double-confirmed
    const winner = results.find((r) => r.status === 'fulfilled').value;
    const bookingId = new mongoose.Types.ObjectId();
    const first = await seats.confirmSeats(winner.reservationId, bookingId, ['A1', 'A2']);
    const second = await seats.confirmSeats(winner.reservationId, bookingId, ['A1', 'A2']);
    assert.strictEqual(first, 2); assert.strictEqual(second, 0);

    // expire a hold -> seat can be taken again
    await seats.holdSeats(tripId, ['A3']);
    await Inv.updateOne({ tripId, seatId: 'A3' }, { $set: { holdExpiresAt: new Date(Date.now() - 1000) } });
    const retaken = await seats.holdSeats(tripId, ['A3']);
    assert.ok(retaken.reservationId);
  } finally {
    await Inv.deleteMany({ tripId }); await Trip.deleteOne({ _id: tripId }); await mongoose.disconnect();
  }
});

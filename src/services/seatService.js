const TripSeatInventory = require('../models/TripSeatInventory');
const Trip = require('../models/Trip');
const VehicleLayout = require('../models/VehicleLayout');
const Setting = require('../models/Setting');
const ApiError = require('../utils/ApiError');
const { generateReservationId } = require('../utils/codes');

/** Create one inventory row per bookable seat of the trip's pinned layout. */
async function createInventory(trip, layout) {
  const prices = trip.fare.categoryPrices || new Map();
  const get = (cat) => (prices instanceof Map ? prices.get(cat) : prices[cat]);
  const docs = layout.seats
    .filter((s) => s.active)
    .map((s) => ({
      tripId: trip._id,
      seatId: s.seatId,
      seatNumber: s.seatNumber,
      category: s.pricingCategory || s.category,
      status: s.bookable ? 'available' : 'blocked',
      price: get(s.pricingCategory) ?? get(s.category) ?? trip.fare.base,
    }));
  if (docs.length) await TripSeatInventory.insertMany(docs, { ordered: true });
  return docs.length;
}

/**
 * Atomically hold seats. Each seat is claimed with a conditional update, so
 * two concurrent requests can never both win the same seat. If any seat cannot be
 * claimed everything already claimed by this reservation is rolled back.
 */
async function holdSeats(tripId, seatIds, { minutes } = {}) {
  const settings = await Setting.getAll();
  const holdMin = minutes || settings.holdMinutes || 10;
  const trip = await Trip.findById(tripId).lean();
  if (!trip) throw ApiError.notFound('Trip not found');
  if (trip.status !== 'scheduled' || !trip.bookingOpen) throw ApiError.conflict('Booking is closed for this trip');
  if (new Date(trip.departureAt) <= new Date()) throw ApiError.conflict('This trip has already departed');

  const unique = [...new Set(seatIds)];
  if (!unique.length) throw ApiError.badRequest('Select at least one seat');
  if (unique.length > 10) throw ApiError.badRequest('You can book at most 10 seats at a time');

  const reservationId = generateReservationId();
  const holdExpiresAt = new Date(Date.now() + holdMin * 60 * 1000);
  const now = new Date();
  const claimed = [];
  const failed = [];

  for (const seatId of unique) {
    const res = await TripSeatInventory.findOneAndUpdate(
      {
        tripId,
        seatId,
        $or: [
          { status: 'available' },
          { status: 'held', holdExpiresAt: { $lte: now } }, // expired hold can be taken over
        ],
      },
      { $set: { status: 'held', reservationId, holdExpiresAt, bookingId: null } },
      { new: true }
    );
    if (res) claimed.push(res);
    else failed.push(seatId);
  }

  if (failed.length) {
    await releaseReservation(reservationId);
    throw ApiError.conflict('Some seats are no longer available', { unavailableSeats: failed });
  }
  return { reservationId, holdExpiresAt, seats: claimed };
}

/** Release held seats of a reservation (never touches booked seats). */
async function releaseReservation(reservationId) {
  return TripSeatInventory.updateMany(
    { reservationId, status: 'held' },
    { $set: { status: 'available', reservationId: null, holdExpiresAt: null, bookingId: null } }
  );
}

/** Convert held seats to booked. Returns the number confirmed. Atomic per seat. */
async function confirmSeats(reservationId, bookingId, seatIds) {
  const res = await TripSeatInventory.updateMany(
    { reservationId, seatId: { $in: seatIds }, status: 'held' },
    { $set: { status: 'booked', bookingId, holdExpiresAt: null } }
  );
  return res.modifiedCount;
}

/** Free booked seats after cancellation (explicit rule, controlled by settings). */
async function releaseBookedSeats(bookingId) {
  return TripSeatInventory.updateMany(
    { bookingId, status: 'booked' },
    { $set: { status: 'available', reservationId: null, bookingId: null, holdExpiresAt: null } }
  );
}

/** Seat map for a trip: layout + live state. Expired holds are shown as available. */
async function getSeatMap(tripId) {
  const trip = await Trip.findById(tripId)
    .populate('vehicleId', 'name registrationNumber operator vehicleType amenities')
    .populate('routeId')
    .lean();
  if (!trip) throw ApiError.notFound('Trip not found');
  const layout = await VehicleLayout.findById(trip.layoutId).lean();
  const inventory = await TripSeatInventory.find({ tripId }).lean();
  const now = Date.now();
  const seats = {};
  inventory.forEach((i) => {
    let status = i.status;
    if (status === 'held' && i.holdExpiresAt && new Date(i.holdExpiresAt).getTime() <= now) status = 'available';
    seats[i.seatId] = { status, price: i.price, seatNumber: i.seatNumber, reservationId: undefined };
  });
  const counts = Object.values(seats).reduce((a, s) => { a[s.status] = (a[s.status] || 0) + 1; return a; }, {});
  return { trip, layout, seats, counts, serverTime: new Date() };
}

/** Background cleanup: release holds whose time is up. */
async function expireHolds() {
  const res = await TripSeatInventory.updateMany(
    { status: 'held', holdExpiresAt: { $lte: new Date() } },
    { $set: { status: 'available', reservationId: null, holdExpiresAt: null, bookingId: null } }
  );
  return res.modifiedCount;
}

module.exports = { createInventory, holdSeats, releaseReservation, confirmSeats, releaseBookedSeats, getSeatMap, expireHolds };

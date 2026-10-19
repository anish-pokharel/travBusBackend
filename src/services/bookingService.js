const crypto = require('crypto');
const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const Refund = require('../models/Refund');
const Trip = require('../models/Trip');
const Setting = require('../models/Setting');
const Notification = require('../models/Notification');
const TripSeatInventory = require('../models/TripSeatInventory');
const seats = require('./seatService');
const providers = require('./paymentProviders');
const ApiError = require('../utils/ApiError');
const { generatePNR, generateTicketNo } = require('../utils/codes');

const round2 = (n) => Math.round(n * 100) / 100;

/** Build the booking from seats currently held under a reservation. Prices come from inventory only. */
async function createBookingFromHold({ reservationId, tripId, passengers, contact, source, user, counterId }) {
  const held = await TripSeatInventory.find({ reservationId, tripId, status: 'held' }).lean();
  if (!held.length) throw ApiError.conflict('Your seat reservation has expired. Please select seats again.');
  if (held.some((h) => h.holdExpiresAt && new Date(h.holdExpiresAt) <= new Date())) {
    throw ApiError.conflict('Your seat reservation has expired. Please select seats again.');
  }
  if (!Array.isArray(passengers) || passengers.length !== held.length) {
    throw ApiError.badRequest('Provide passenger details for every selected seat');
  }
  const bySeat = new Map(held.map((h) => [h.seatId, h]));
  const seen = new Set();
  const list = passengers.map((p) => {
    const inv = bySeat.get(p.seatId);
    if (!inv || seen.has(p.seatId)) throw ApiError.badRequest(`Seat ${p.seatId} is not part of this reservation`);
    seen.add(p.seatId);
    return {
      name: String(p.name || '').trim(), phone: p.phone, age: p.age, gender: p.gender || '',
      seatId: inv.seatId, seatNumber: inv.seatNumber, price: inv.price,
    };
  });
  if (list.some((p) => !p.name)) throw ApiError.badRequest('Passenger name is required for every seat');

  const total = round2(list.reduce((s, p) => s + p.price, 0)); // authoritative total

  return Booking.create({
    tripId, userId: user?._id, source, counterId,
    staffId: source === 'counter' ? user._id : undefined,
    contact, passengers: list, reservationId,
    holdExpiresAt: held[0].holdExpiresAt, totalAmount: total,
    status: 'held', paymentStatus: 'unpaid',
  });
}

/** Online checkout: create the booking + a pending payment with the chosen gateway. */
async function checkoutOnline({ user, reservationId, tripId, passengers, contact, method }) {
  if (!['esewa', 'khalti'].includes(method)) throw ApiError.badRequest('Unsupported online payment method');
  const existing = await Booking.findOne({ reservationId });
  if (existing) throw ApiError.conflict('This reservation already has a booking');

  const booking = await createBookingFromHold({ reservationId, tripId, passengers, contact, source: 'online', user });
  // give the passenger a little extra time to pay at the gateway
  const holdExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
  await TripSeatInventory.updateMany({ reservationId, status: 'held' }, { $set: { holdExpiresAt } });
  booking.holdExpiresAt = holdExpiresAt;
  booking.paymentMethod = method;
  booking.paymentStatus = 'pending';
  await booking.save();

  const payment = await Payment.create({
    bookingId: booking._id, method, amount: booking.totalAmount,
    transactionRef: crypto.randomUUID(), status: 'pending',
  });
  let init;
  try {
    init = await providers[method].initiate({ payment, booking });
  } catch (e) {
    await abandonBooking(booking, 'Payment could not be started');
    throw e;
  }
  if (init.pidx) { payment.providerRef = init.pidx; await payment.save(); }
  return { booking, payment: { id: payment._id, method, amount: payment.amount }, init };
}

/** Called after server-side gateway verification. Idempotent: safe to call repeatedly. */
async function finalizeOnlinePayment(method, verified) {
  const filter = method === 'khalti' ? { method, providerRef: verified.pidx } : { method, transactionRef: verified.transactionRef };
  const payment = await Payment.findOne(filter);
  if (!payment) throw ApiError.notFound('Payment not found');

  if (payment.status === 'success') return { booking: await Booking.findById(payment.bookingId), duplicate: true };

  if (!verified.ok) {
    await Payment.updateOne({ _id: payment._id, status: 'pending' }, { $set: { status: 'failed', raw: verified.raw } });
    await Booking.updateOne({ _id: payment.bookingId, status: 'held' }, { $set: { paymentStatus: 'failed' } });
    throw ApiError.badRequest('Payment was not completed');
  }
  if (verified.amount !== undefined && Math.abs(verified.amount - payment.amount) > 0.01) {
    await Payment.updateOne({ _id: payment._id, status: 'pending' }, { $set: { status: 'failed', raw: verified.raw } });
    throw ApiError.badRequest('Paid amount does not match the booking total');
  }

  // atomic pending -> success transition; only one concurrent callback wins
  const won = await Payment.findOneAndUpdate(
    { _id: payment._id, status: 'pending' },
    { $set: { status: 'success', paidAt: new Date(), providerRef: verified.providerRef || payment.providerRef, raw: verified.raw } },
    { new: true }
  );
  if (!won) return { booking: await Booking.findById(payment.bookingId), duplicate: true };

  const booking = await confirmBooking(payment.bookingId, won);
  return { booking, duplicate: false };
}

/** held -> confirmed. Seats must still belong to this reservation. */
async function confirmBooking(bookingId, payment) {
  const booking = await Booking.findById(bookingId);
  if (!booking) throw ApiError.notFound('Booking not found');
  if (booking.status === 'confirmed') return booking;
  if (booking.status !== 'held') {
    // payment arrived for a booking that is no longer held (expired/cancelled): refund it
    await createRefund(booking, payment, 100, 'Payment received after booking expired');
    throw ApiError.conflict('Booking expired before payment was confirmed; a refund has been queued');
  }

  const seatIds = booking.passengers.map((p) => p.seatId);
  const confirmed = await seats.confirmSeats(booking.reservationId, booking._id, seatIds);
  if (confirmed !== seatIds.length) {
    // someone took an expired hold: roll back what we confirmed and refund
    await TripSeatInventory.updateMany({ bookingId: booking._id, status: 'booked' },
      { $set: { status: 'available', bookingId: null, reservationId: null } });
    booking.status = 'cancelled';
    booking.cancelReason = 'Seats were no longer available when payment completed';
    booking.cancelledAt = new Date();
    await booking.save();
    await createRefund(booking, payment, 100, booking.cancelReason);
    throw ApiError.conflict('Seats were taken before payment completed; a full refund has been queued');
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      booking.pnr = generatePNR();
      booking.passengers.forEach((p) => { p.ticketNo = generateTicketNo(); });
      booking.status = 'confirmed';
      booking.paymentStatus = 'paid';
      booking.paymentMethod = payment.method;
      booking.confirmedAt = new Date();
      booking.holdExpiresAt = undefined;
      await booking.save();
      break;
    } catch (e) {
      if (e.code === 11000 && attempt < 4) continue; // PNR collision, retry
      throw e;
    }
  }
  if (booking.userId) {
    await Notification.create({
      userId: booking.userId, title: 'Booking confirmed',
      message: `Your booking ${booking.pnr} is confirmed.`, type: 'booking', link: `/user/bookings/${booking.pnr}`,
    });
  }
  return booking;
}

/** Counter flow: hold, book and collect payment in one server-side operation. */
async function bookAtCounter({ user, counter, tripId, seatIds, passengers, contact, paymentMethod }) {
  const method = paymentMethod || 'cash';
  if (!['cash', 'other'].includes(method)) throw ApiError.badRequest('Counters accept cash or other authorized methods');
  const hold = await seats.holdSeats(tripId, seatIds, { minutes: 5 });
  try {
    const booking = await createBookingFromHold({
      reservationId: hold.reservationId, tripId, passengers, contact, source: 'counter', user, counterId: counter._id,
    });
    booking.paymentMethod = method;
    await booking.save();
    const payment = await Payment.create({
      bookingId: booking._id, method, amount: booking.totalAmount, status: 'success',
      paidAt: new Date(), receivedBy: user._id, counterId: counter._id,
    });
    const confirmed = await confirmBooking(booking._id, payment);
    return { booking: confirmed, payment };
  } catch (e) {
    await seats.releaseReservation(hold.reservationId);
    throw e;
  }
}

async function abandonBooking(booking, reason) {
  await seats.releaseReservation(booking.reservationId);
  booking.status = 'expired';
  booking.cancelReason = reason;
  booking.paymentStatus = booking.paymentStatus === 'paid' ? 'paid' : 'failed';
  await booking.save();
}

function refundPercentFor(policy, hoursBefore) {
  const tiers = [...policy].sort((a, b) => b.hoursBefore - a.hoursBefore);
  for (const t of tiers) if (hoursBefore >= t.hoursBefore) return t.refundPercent;
  return 0;
}

async function createRefund(booking, payment, percent, reason, requestedBy) {
  if (!payment || payment.status === 'failed' || payment.status === 'pending') return null;
  const amount = round2((payment.amount * percent) / 100);
  if (amount <= 0) return null;
  return Refund.create({
    bookingId: booking._id, paymentId: payment._id, amount, percent, reason, requestedBy, status: 'pending',
  });
}

/** Cancel a confirmed booking according to the admin-configured policy. */
async function cancelBooking({ booking, user, reason, fullRefund = false }) {
  if (booking.status !== 'confirmed') throw ApiError.conflict(`A ${booking.status} booking cannot be cancelled`);
  if (!fullRefund && booking.passengers.some((p) => p.checkedIn)) throw ApiError.conflict('A checked-in ticket cannot be cancelled');
  const settings = await Setting.getAll();
  const trip = await Trip.findById(booking.tripId).lean();
  if (!trip) throw ApiError.notFound('Trip not found');
  if (!fullRefund && new Date(trip.departureAt) <= new Date() && user.role !== 'admin') throw ApiError.conflict('The trip has already departed');
  if (!fullRefund && user.role === 'passenger' && !settings.allowOnlineCancellation) throw ApiError.forbidden('Online cancellation is disabled');

  // atomic confirmed -> cancelled so two requests can't both cancel
  const cancelled = await Booking.findOneAndUpdate(
    { _id: booking._id, status: 'confirmed' },
    { $set: { status: 'cancelled', cancelledAt: new Date(), cancelReason: reason || 'Cancelled by user', cancelledBy: user._id } },
    { new: true }
  );
  if (!cancelled) throw ApiError.conflict('Booking was already changed');

  const hoursBefore = (new Date(trip.departureAt) - Date.now()) / 36e5;
  const percent = fullRefund ? 100 : (hoursBefore < 0 ? 0 : refundPercentFor(settings.cancellationPolicy, hoursBefore));
  const payment = await Payment.findOne({ bookingId: booking._id, status: { $in: ['success', 'partially_refunded'] } });
  const refund = await createRefund(cancelled, payment, percent, reason || 'Booking cancelled', user._id);
  cancelled.refundAmount = refund ? refund.amount : 0;
  await cancelled.save();

  if (settings.releaseSeatsOnCancel) await seats.releaseBookedSeats(booking._id);
  return { booking: cancelled, refund, refundPercent: percent };
}

/** Admin/counter marks a queued refund as paid out. */
async function processRefund({ refund, user, approve, note }) {
  const updated = await Refund.findOneAndUpdate(
    { _id: refund._id, status: 'pending' },
    { $set: { status: approve ? 'completed' : 'rejected', processedBy: user._id, processedAt: new Date(), note } },
    { new: true }
  );
  if (!updated) throw ApiError.conflict('Refund was already processed');
  if (approve) {
    const payment = await Payment.findById(updated.paymentId);
    payment.refundedAmount = round2((payment.refundedAmount || 0) + updated.amount);
    payment.status = payment.refundedAmount >= payment.amount ? 'refunded' : 'partially_refunded';
    await payment.save();
    await Booking.updateOne({ _id: updated.bookingId }, {
      $set: { paymentStatus: payment.status, ...(payment.status === 'refunded' ? { status: 'refunded' } : {}) },
    });
  }
  return updated;
}

/** Expire unpaid online bookings whose hold is over. Called by the cron job. */
async function expireStaleBookings() {
  const stale = await Booking.find({ status: 'held', holdExpiresAt: { $lte: new Date() } }).limit(200);
  for (const b of stale) {
    const paid = await Payment.exists({ bookingId: b._id, status: 'success' });
    if (paid) continue; // a successful payment is being finalized
    await abandonBooking(b, 'Payment not completed in time');
  }
  return stale.length;
}

module.exports = {
  checkoutOnline, finalizeOnlinePayment, bookAtCounter, cancelBooking, processRefund,
  expireStaleBookings, refundPercentFor, confirmBooking,
};

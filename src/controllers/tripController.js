const Trip = require("../models/Trip");
const Vehicle = require("../models/Vehicle");
const Route = require("../models/Route");
const VehicleLayout = require("../models/VehicleLayout");
const Booking = require("../models/Booking");
const TripSeatInventory = require("../models/TripSeatInventory");
const seatService = require("../services/seatService");
const bookingService = require("../services/bookingService");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");
const audit = require("../utils/audit");
const mongoose = require("mongoose");
const NPT_OFFSET_MS = (5 * 60 + 45) * 60 * 1000;

/** Midnight (Nepal time) of the day containing `d`, as a UTC instant. */
function nepalMidnight(d) {
  const local = new Date(d.getTime() + NPT_OFFSET_MS);
  return new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) -
      NPT_OFFSET_MS,
  );
}

exports.search = asyncHandler(async (req, res) => {
  const {
    from,
    to,
    date,
    type,
    maxPrice,
    minPrice,
    amenity,
    minSeats,
    timeFrom,
    timeTo,
  } = req.query;
  if (!from || !to || !date)
    throw ApiError.badRequest("from, to and date are required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw ApiError.badRequest("date must be YYYY-MM-DD");

  const start = new Date(
    new Date(`${date}T00:00:00Z`).getTime() - NPT_OFFSET_MS,
  );
  const end = new Date(start.getTime() + 24 * 3600 * 1000);
  const ci = (v) =>
    new RegExp(`^${String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");

  const routes = await Route.find({
    status: "active",
    departureCity: ci(from),
    destinationCity: ci(to),
  }).lean();
  if (!routes.length) return res.json({ success: true, data: [] });

  const trips = await Trip.find({
    routeId: { $in: routes.map((r) => r._id) },
    status: "scheduled",
    bookingOpen: true,
    departureAt: {
      $gte: new Date(Math.max(start.getTime(), Date.now())),
      $lt: end,
    },
  })
    .populate(
      "vehicleId",
      "name registrationNumber operator vehicleType amenities status",
    )
    .populate("routeId")
    .sort({ departureAt: 1 })
    .lean();

  const avail = await TripSeatInventory.aggregate([
    { $match: { tripId: { $in: trips.map((t) => t._id) } } },
    {
      $group: {
        _id: "$tripId",
        available: {
          $sum: {
            $cond: [
              {
                $or: [
                  { $eq: ["$status", "available"] },
                  {
                    $and: [
                      { $eq: ["$status", "held"] },
                      { $lte: ["$holdExpiresAt", new Date()] },
                    ],
                  },
                ],
              },
              1,
              0,
            ],
          },
        },
        total: { $sum: { $cond: [{ $ne: ["$status", "blocked"] }, 1, 0] } },
        minPrice: { $min: "$price" },
        maxPrice: { $max: "$price" },
      },
    },
  ]);
  const map = new Map(avail.map((a) => [String(a._id), a]));

  let out = trips
    .filter((t) => t.vehicleId?.status === "active")
    .map((t) => {
      const a = map.get(String(t._id)) || {
        available: 0,
        total: 0,
        minPrice: t.fare.base,
        maxPrice: t.fare.base,
      };
      return {
        _id: t._id,
        departureAt: t.departureAt,
        arrivalAt: t.arrivalAt,
        route: t.routeId,
        vehicle: t.vehicleId,
        durationMin: t.routeId.durationMin,
        fareFrom: a.minPrice,
        fareTo: a.maxPrice,
        availableSeats: a.available,
        totalSeats: a.total,
      };
    });

  if (type) out = out.filter((t) => t.vehicle.vehicleType === type);
  if (minPrice) out = out.filter((t) => t.fareTo >= Number(minPrice));
  if (maxPrice) out = out.filter((t) => t.fareFrom <= Number(maxPrice));
  if (minSeats) out = out.filter((t) => t.availableSeats >= Number(minSeats));
  if (amenity) {
    const am = [].concat(amenity);
    out = out.filter((t) => am.every((x) => t.vehicle.amenities?.includes(x)));
  }
  const hm = (d) => {
    const l = new Date(d.getTime() + NPT_OFFSET_MS);
    return l.getUTCHours() * 60 + l.getUTCMinutes();
  };
  const toMin = (s) => {
    const [h, m] = String(s).split(":").map(Number);
    return h * 60 + (m || 0);
  };
  if (timeFrom)
    out = out.filter((t) => hm(new Date(t.departureAt)) >= toMin(timeFrom));
  if (timeTo)
    out = out.filter((t) => hm(new Date(t.departureAt)) <= toMin(timeTo));

  res.json({ success: true, data: out });
});

exports.get = asyncHandler(async (req, res) => {
  const t = await Trip.findById(req.params.id)
    .populate("vehicleId")
    .populate("routeId")
    .populate("layoutId", "name version totalSeats bookableSeats");
  if (!t) throw ApiError.notFound("Trip not found");
  res.json({ success: true, data: t });
});

exports.list = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const limit = Math.min(100, parseInt(req.query.limit || "20", 10));
  const q = {};
  if (req.query.status) q.status = req.query.status;
  if (req.query.vehicleId) q.vehicleId = req.query.vehicleId;
  if (req.query.routeId) q.routeId = req.query.routeId;
  if (req.query.date) {
    const s = new Date(
      new Date(`${req.query.date}T00:00:00Z`).getTime() - NPT_OFFSET_MS,
    );
    q.departureAt = { $gte: s, $lt: new Date(s.getTime() + 86400000) };
  }
  const [items, total] = await Promise.all([
    Trip.find(q)
      .populate("vehicleId", "name registrationNumber vehicleType")
      .populate("routeId", "name departureCity destinationCity durationMin")
      .sort({ departureAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Trip.countDocuments(q),
  ]);
  const counts = await TripSeatInventory.aggregate([
    { $match: { tripId: { $in: items.map((i) => i._id) } } },
    { $group: { _id: { t: "$tripId", s: "$status" }, n: { $sum: 1 } } },
  ]);
  const cm = {};
  counts.forEach((c) => {
    (cm[c._id.t] ||= {})[c._id.s] = c.n;
  });
  items.forEach((i) => {
    i.seatCounts = cm[i._id] || {};
  });
  res.json({ success: true, data: items, meta: { page, limit, total } });
});

// counter staff / admin: upcoming trips for walk-in sales (any city)
exports.upcoming = asyncHandler(async (req, res) => {
  const q = {
    status: "scheduled",
    bookingOpen: true,
    departureAt: { $gte: new Date() },
  };
  if (req.query.date) {
    const s = new Date(
      new Date(`${req.query.date}T00:00:00Z`).getTime() - NPT_OFFSET_MS,
    );
    q.departureAt = {
      $gte: new Date(Math.max(s.getTime(), Date.now())),
      $lt: new Date(s.getTime() + 86400000),
    };
  }
  if (req.query.routeId) q.routeId = req.query.routeId;
  const items = await Trip.find(q)
    .populate("vehicleId", "name registrationNumber vehicleType operator")
    .populate("routeId", "name departureCity destinationCity")
    .sort({ departureAt: 1 })
    .limit(100)
    .lean();
  const counts = await TripSeatInventory.aggregate([
    {
      $match: { tripId: { $in: items.map((i) => i._id) }, status: "available" },
    },
    { $group: { _id: "$tripId", n: { $sum: 1 } } },
  ]);
  const m = new Map(counts.map((c) => [String(c._id), c.n]));
  items.forEach((i) => {
    i.availableSeats = m.get(String(i._id)) || 0;
  });
  res.json({ success: true, data: items });
});

exports.create = asyncHandler(async (req, res) => {
  const b = req.body;
  const [vehicle, route] = await Promise.all([
    Vehicle.findById(b.vehicleId),
    Route.findById(b.routeId),
  ]);
  if (!vehicle || vehicle.status !== "active")
    throw ApiError.badRequest("Vehicle not found or inactive");
  if (!route || route.status !== "active")
    throw ApiError.badRequest("Route not found or inactive");
  if (!vehicle.layoutId)
    throw ApiError.badRequest("Assign a seat layout to the vehicle first");
  const layout = await VehicleLayout.findById(vehicle.layoutId);
  if (!layout || layout.status !== "active")
    throw ApiError.badRequest("Vehicle layout is missing or archived");

  const departureAt = new Date(b.departureAt);
  if (Number.isNaN(departureAt.getTime()))
    throw ApiError.badRequest("Invalid departure time");
  if (departureAt <= new Date())
    throw ApiError.badRequest("Departure must be in the future");
  if (departureAt > new Date(Date.now() + 365 * 86400000))
    throw ApiError.badRequest("Departure is too far in the future");
  
  
  // const arrivalAt = b.arrivalAt
  //   ? new Date(b.arrivalAt)
  //   : new Date(departureAt.getTime() + route.durationMin * 60000);
  // if (arrivalAt <= departureAt)
  //   throw ApiError.badRequest("Arrival must be after departure");

const arrivalAt = b.arrivalAt
  ? new Date(b.arrivalAt)
  : new Date(
      departureAt.getTime() + route.durationMin * 60000
    );

console.log('[TRIP CREATE] Parsed departure:', departureAt);
console.log('[TRIP CREATE] Parsed arrival:', arrivalAt);
console.log(
  '[TRIP CREATE] Arrival valid:',
  !Number.isNaN(arrivalAt.getTime())
);

if (Number.isNaN(arrivalAt.getTime())) {
  throw ApiError.badRequest('Invalid arrivalAt date value');
}

if (arrivalAt <= departureAt) {
  throw ApiError.badRequest('Arrival must be after departure');
}

  // const overlap = await Trip.findOne({
  //   vehicleId: vehicle._id,
  //   status: { $ne: "cancelled" },
  //   departureAt: { $lt: arrivalAt },
  //   arrivalAt: { $gt: departureAt },
  // });

const overlap = await Trip.findOne({
  vehicleId: vehicle._id,
  status: mongoose.trusted({ $ne: "cancelled" }),
  departureAt: mongoose.trusted({ $lt: arrivalAt }),
  arrivalAt: mongoose.trusted({ $gt: departureAt }),
});



  if (overlap)
    throw ApiError.conflict(
      "This vehicle is already assigned to an overlapping trip",
      { tripId: overlap._id },
    );

  const trip = await Trip.create({
    vehicleId: vehicle._id,
    routeId: route._id,
    layoutId: layout._id,
    departureAt,
    arrivalAt,
    travelDate: nepalMidnight(departureAt),
    fare: { base: b.fare.base, categoryPrices: b.fare.categoryPrices || {} },
    createdBy: req.user._id,
  });
  try {
    await seatService.createInventory(trip, layout);
  } catch (e) {
    await TripSeatInventory.deleteMany({ tripId: trip._id });
    await Trip.deleteOne({ _id: trip._id });
    throw e;
  }
  await audit(req, "trip.create", "Trip", trip._id);
  res.status(201).json({ success: true, data: trip });
});

exports.update = asyncHandler(async (req, res) => {
  const trip = await Trip.findById(req.params.id);
  if (!trip) throw ApiError.notFound("Trip not found");
  const b = req.body;
  const sold = await TripSeatInventory.countDocuments({
    tripId: trip._id,
    status: { $in: ["booked", "held"] },
  });
  if (b.bookingOpen !== undefined) trip.bookingOpen = b.bookingOpen;
  if (b.status && ["boarding", "departed", "completed"].includes(b.status))
    trip.status = b.status;
  if (b.fare) {
    if (sold)
      throw ApiError.conflict(
        "Fares cannot change once seats are held or booked",
      );
    trip.fare = {
      base: b.fare.base,
      categoryPrices: b.fare.categoryPrices || {},
    };
    const layout = await VehicleLayout.findById(trip.layoutId).lean();
    for (const s of layout.seats) {
      const price =
        trip.fare.categoryPrices.get?.(s.pricingCategory) ??
        b.fare.categoryPrices?.[s.pricingCategory] ??
        trip.fare.base;
      await TripSeatInventory.updateOne(
        {
          tripId: trip._id,
          seatId: s.seatId,
          status: { $in: ["available", "blocked"] },
        },
        { $set: { price } },
      );
    }
  }
  await trip.save();
  await audit(req, "trip.update", "Trip", trip._id, b);
  res.json({ success: true, data: trip });
});

/** Cancel a trip: every confirmed booking is cancelled with a full refund queued. */
exports.cancel = asyncHandler(async (req, res) => {
  const trip = await Trip.findById(req.params.id);
  if (!trip) throw ApiError.notFound("Trip not found");
  if (trip.status === "cancelled")
    throw ApiError.conflict("Trip already cancelled");
  trip.status = "cancelled";
  trip.bookingOpen = false;
  await trip.save();
  const bookings = await Booking.find({
    tripId: trip._id,
    status: "confirmed",
  });
  for (const b of bookings) {
    try {
      await bookingService.cancelBooking({
        booking: b,
        user: req.user,
        reason: req.body.reason || "Trip cancelled by operator",
        fullRefund: true,
      });
    } catch (e) {
      console.error("trip cancel booking failed", b._id, e.message);
    }
  }
  await TripSeatInventory.updateMany(
    { tripId: trip._id, status: "held" },
    { $set: { status: "available", reservationId: null, holdExpiresAt: null } },
  );
  await audit(req, "trip.cancel", "Trip", trip._id, {
    bookings: bookings.length,
  });
  res.json({
    success: true,
    message: `Trip cancelled; ${bookings.length} booking(s) cancelled and refunds queued.`,
  });
});

// admin: block / unblock seats on a trip (e.g. reserved for staff)
exports.setSeatBlock = asyncHandler(async (req, res) => {
  const { seatIds, blocked } = req.body;
  const filter = { tripId: req.params.id, seatId: { $in: seatIds } };
  const result = blocked
    ? await TripSeatInventory.updateMany(
        { ...filter, status: "available" },
        { $set: { status: "blocked" } },
      )
    : await TripSeatInventory.updateMany(
        { ...filter, status: "blocked" },
        { $set: { status: "available" } },
      );
  await audit(
    req,
    blocked ? "trip.block_seats" : "trip.unblock_seats",
    "Trip",
    req.params.id,
    { seatIds },
  );
  res.json({ success: true, data: { modified: result.modifiedCount } });
});





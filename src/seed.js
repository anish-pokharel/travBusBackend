/**
 * Seed script: creates the first admin, a counter + counter staff, starter layouts, vehicles,
 * routes and a few upcoming trips so the system is usable immediately.
 * Safe to re-run: existing records (by unique keys) are left untouched.
 *   npm run seed
 */
const mongoose = require('mongoose');
const crypto = require('crypto');
const connectDB = require('./config/db');
const User = require('./models/User');
const Counter = require('./models/Counter');
const CounterStaffAssignment = require('./models/CounterStaffAssignment');
const Vehicle = require('./models/Vehicle');
const VehicleLayout = require('./models/VehicleLayout');
const Route = require('./models/Route');
const Trip = require('./models/Trip');
const Setting = require('./models/Setting');
const seatService = require('./services/seatService');
const { build } = require('./utils/layoutTemplates');
const { validateLayout } = require('./utils/layoutValidator');

const NPT = (5 * 60 + 45) * 60 * 1000;

(async () => {
  await connectDB();
  await mongoose.syncIndexes();

  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@example.com').toLowerCase();
  const pwd = process.env.SEED_ADMIN_PASSWORD;
  if (!pwd || pwd.length < 8) throw new Error('Set SEED_ADMIN_PASSWORD (min 8 chars) in .env');
  let admin = await User.findOne({ email });
  if (!admin) { admin = await User.create({ name: 'System Admin', email, password: pwd, role: 'admin' }); console.log(`Admin created: ${email}`); }
  else console.log(`Admin exists: ${email}`);

  for (const [key, v] of Object.entries(Setting.DEFAULTS)) await Setting.updateOne({ key }, { $setOnInsert: { value: v } }, { upsert: true });

  let counter = await Counter.findOne({ code: 'BTW01' });
  if (!counter) counter = await Counter.create({ name: 'Butwal Main Counter', code: 'BTW01', city: 'Butwal', address: 'Bus Park, Butwal', phone: '9800000000' });
  const staffEmail = 'counter@example.com';
  let staff = await User.findOne({ email: staffEmail });
  if (!staff) {
    const staffPwd = crypto.randomBytes(9).toString('base64url') + '9a';
    staff = await User.create({ name: 'Counter Staff', email: staffEmail, password: staffPwd, role: 'counter', counterId: counter._id });
    await CounterStaffAssignment.create({ counterId: counter._id, userId: staff._id, assignedBy: admin._id });
    console.log(`Counter staff created: ${staffEmail} / ${staffPwd}   (change it after first login)`);
  }

  // Layout templates
  const defs = [['tourist_2x2', 'Tourist Bus 2+2 (40 seats)', { rows: 10 }], ['hiace_1x2', 'HiAce 1+2', { rows: 4 }], ['car', 'Car / Taxi'], ['sleeper', 'Sleeper Bus']];
  const layouts = {};
  for (const [tpl, name, opts] of defs) {
    let l = await VehicleLayout.findOne({ name });
    if (!l) {
      const data = build(tpl, opts);
      const v = validateLayout(data);
      if (!v.valid) throw new Error(`Template ${tpl} invalid: ${JSON.stringify(v.errors)}`);
      l = await VehicleLayout.create({ ...data, name, layoutKey: crypto.randomUUID(), version: 1, createdBy: admin._id, updatedBy: admin._id });
    }
    layouts[tpl] = l;
  }

  const vdefs = [
    ['Himalayan Express', 'BA 1 KHA 1234', 'Himalayan Travels', 'tourist_bus', 'tourist_2x2', ['AC', 'WiFi', 'Charging', 'Water']],
    ['Lumbini HiAce', 'LU 1 CHA 5678', 'Lumbini Tours', 'hiace', 'hiace_1x2', ['AC', 'Charging']],
    ['City Taxi', 'LU 2 PA 9012', 'City Cabs', 'car', 'car', ['AC']],
    ['Night Rider Sleeper', 'GA 1 KHA 3456', 'Night Rider', 'sleeper_bus', 'sleeper', ['AC', 'Blanket', 'Charging']],
  ];
  const vehicles = [];
  for (const [name, reg, operator, type, tpl, amenities] of vdefs) {
    let v = await Vehicle.findOne({ registrationNumber: reg });
    if (!v) v = await Vehicle.create({ name, registrationNumber: reg, operator, vehicleType: type, layoutId: layouts[tpl]._id, seatCapacity: layouts[tpl].bookableSeats, amenities });
    vehicles.push(v);
  }

  const rdefs = [['Butwal', 'Kathmandu', 270, 480, [['Narayanghat', 120, 130, 130], ['Mugling', 180, 190, 180]]], ['Kathmandu', 'Pokhara', 200, 400, []], ['Butwal', 'Pokhara', 160, 300, []]];
  const routes = [];
  for (const [from, to, km, dur, stops] of rdefs) {
    let r = await Route.findOne({ departureCity: from, destinationCity: to });
    if (!r) r = await Route.create({ departureCity: from, destinationCity: to, distanceKm: km, durationMin: dur,
      stops: stops.map(([city, a, d, dist], i) => ({ city, sequence: i + 1, arrivalOffsetMin: a, departureOffsetMin: d, distanceFromStartKm: dist })) });
    routes.push(r);
  }

  if ((await Trip.countDocuments()) === 0) {
    const plan = [[0, 0, 1, 6, 0, 1800], [1, 0, 1, 14, 0, 1800], [1, 1, 1, 7, 30, 1500], [2, 2, 1, 8, 0, 1200], [3, 0, 1, 19, 0, 2200]];
    for (let day = 1; day <= 3; day++) {
      for (const [vi, ri, , hh, mm, base] of plan) {
        const dep = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + day, hh, mm) - NPT);
        const route = routes[ri]; const vehicle = vehicles[vi];
        const overlap = await Trip.findOne({ vehicleId: vehicle._id, departureAt: { $lt: new Date(dep.getTime() + route.durationMin * 60000) }, arrivalAt: { $gt: dep } });
        if (overlap) continue;
        const l = layouts[['tourist_2x2', 'hiace_1x2', 'car', 'sleeper'][vi]];
        const trip = await Trip.create({
          vehicleId: vehicle._id, routeId: route._id, layoutId: l._id, departureAt: dep, arrivalAt: new Date(dep.getTime() + route.durationMin * 60000),
          travelDate: dep, fare: { base, categoryPrices: vi === 3 ? { upper_sleeper: base - 200, lower_sleeper: base } : vi === 1 ? { premium: base + 200 } : {} }, createdBy: admin._id,
        });
        await seatService.createInventory(trip, l);
      }
    }
    console.log('Sample trips created for the next 3 days');
  }

  console.log('Seed complete.');
  await mongoose.connection.close();
})().catch(async (e) => { console.error('Seed failed:', e); await mongoose.connection.close(); process.exit(1); });

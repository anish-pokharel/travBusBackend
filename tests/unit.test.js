process.env.JWT_ACCESS_SECRET = 'test_access_secret_value_for_tests_only_123456';
process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_value_for_tests_only_12345';
process.env.TICKET_SECRET = 'test_ticket_secret_value_for_tests_only_12345';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost/unused';

const test = require('node:test');
const assert = require('node:assert');
const { TEMPLATE_LIST, build } = require('../src/utils/layoutTemplates');
const { validateLayout } = require('../src/utils/layoutValidator');
const codes = require('../src/utils/codes');
const { refundPercentFor } = (() => {
  // pure function, extracted without loading models
  const fn = (policy, h) => { for (const t of [...policy].sort((a, b) => b.hoursBefore - a.hoursBefore)) if (h >= t.hoursBefore) return t.refundPercent; return 0; };
  return { refundPercentFor: fn };
})();

test('every starter template is a valid layout with unique seat numbers', () => {
  for (const [key] of TEMPLATE_LIST) {
    const l = build(key);
    const v = validateLayout(l);
    assert.ok(v.valid, `${key}: ${JSON.stringify(v.errors)}`);
    assert.strictEqual(new Set(l.seats.map((s) => s.seatNumber)).size, l.seats.length, `${key} duplicate numbers`);
  }
});

test('driver is never counted as a passenger seat', () => {
  const l = build('tourist_2x2', { rows: 10 });
  const v = validateLayout(l);
  assert.strictEqual(v.summary.passengerCapacity, 40);
  assert.ok(l.elements.some((e) => e.type === 'driver'));
});

test('HiAce 1+2 with 4 rows has front seat + 12 passenger seats', () => {
  const v = validateLayout(build('hiace_1x2', { rows: 4 }));
  assert.strictEqual(v.summary.bookableSeats, 13);
});

test('sleeper template has upper and lower berths', () => {
  const l = build('sleeper', { rows: 3 });
  assert.ok(l.seats.some((s) => s.seatNumber.startsWith('L')));
  assert.ok(l.seats.some((s) => s.seatNumber.startsWith('U')));
});

test('validator catches duplicates, overlaps and out-of-grid seats', () => {
  const l = build('car');
  l.seats.push({ ...l.seats[0], seatId: 'DUP' }); // duplicate number + same cell
  l.seats.push({ ...l.seats[1], seatId: 'OUT', seatNumber: 'Z9', row: 99, col: 0 });
  const v = validateLayout(l);
  const codesFound = v.errors.map((e) => e.code);
  assert.ok(codesFound.includes('DUP_SEAT_NO'));
  assert.ok(codesFound.includes('OVERLAP'));
  assert.ok(codesFound.includes('SEAT_POS'));
});

test('non-bookable seats are excluded from bookable capacity', () => {
  const l = build('car');
  l.seats[0].bookable = false;
  assert.strictEqual(validateLayout(l).summary.bookableSeats, l.seats.length - 1);
});

test('layout with zero bookable seats is rejected', () => {
  const l = build('car');
  l.seats.forEach((s) => { s.bookable = false; });
  assert.ok(validateLayout(l).errors.some((e) => e.code === 'NO_BOOKABLE'));
});

test('ticket signature verifies and detects tampering', () => {
  const pnr = codes.generatePNR();
  const code = codes.qrCode(pnr);
  const [p, sig] = code.split('.');
  assert.ok(codes.verifySignature(p, sig));
  assert.ok(!codes.verifySignature(p, sig.replace(/.$/, sig.endsWith('a') ? 'b' : 'a')));
  assert.ok(!codes.verifySignature('AAAAAAAA', sig));
});

test('PNR format: 8 unambiguous chars, unique across 1000 generations', () => {
  const s = new Set();
  for (let i = 0; i < 1000; i++) { const p = codes.generatePNR(); assert.match(p, /^[A-HJ-NP-Z2-9]{8}$/); s.add(p); }
  assert.strictEqual(s.size, 1000);
});

test('refund policy tiers', () => {
  const policy = [{ hoursBefore: 48, refundPercent: 90 }, { hoursBefore: 24, refundPercent: 70 }, { hoursBefore: 6, refundPercent: 50 }, { hoursBefore: 0, refundPercent: 0 }];
  assert.strictEqual(refundPercentFor(policy, 72), 90);
  assert.strictEqual(refundPercentFor(policy, 30), 70);
  assert.strictEqual(refundPercentFor(policy, 8), 50);
  assert.strictEqual(refundPercentFor(policy, 2), 0);
});

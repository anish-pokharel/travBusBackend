/**
 * Starter templates. They only produce plain layout data (grid cells); the admin can edit
 * everything afterwards in the Seat Layout Designer. Front of the vehicle = row 0.
 * Nepal drives on the left, so the driver sits on the right-hand side (last column).
 */
const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const seat = (row, col, number, extra = {}) => ({
  seatId: `S-${row}-${col}`,
  seatNumber: number,
  row, col,
  kind: 'seat',
  category: 'regular',
  pricingCategory: 'regular',
  active: true,
  bookable: true,
  position: 'none',
  accessible: false,
  rotation: 0,
  ...extra,
});

const el = (type, row, col, extra = {}) => ({ id: `E-${type}-${row}-${col}`, type, row, col, rowSpan: 1, colSpan: 1, rotation: 0, ...extra });

/** Build rows of seats from a pattern string, e.g. "SS_SS" (S=seat, _=aisle gap). */
function patternRows({ pattern, rowCount, startRow, numbering = 'letter-number', skip = new Set(), blocked = new Set() }) {
  const seats = [];
  for (let r = 0; r < rowCount; r++) {
    let n = 0;
    for (let c = 0; c < pattern.length; c++) {
      if (pattern[c] !== 'S') continue;
      n += 1;
      const gridRow = startRow + r;
      if (skip.has(`${gridRow},${c}`)) continue;
      const number = numbering === 'sequential' ? String(seats.length + 1) : `${letters[r % 26]}${n}`;
      const isEdgeLeft = c === 0 || pattern[c - 1] !== 'S';
      const isEdgeRight = c === pattern.length - 1 || pattern[c + 1] !== 'S';
      const left = isEdgeLeft && c === 0;
      const right = isEdgeRight && c === pattern.length - 1;
      const position = left || right ? 'window' : (isEdgeLeft || isEdgeRight ? 'aisle' : 'middle');
      seats.push(seat(gridRow, c, number, {
        position,
        category: position === 'window' ? 'window' : 'regular',
        bookable: !blocked.has(`${gridRow},${c}`),
      }));
    }
  }
  return seats;
}

function bus({ pattern, rows, name, vehicleType, withRearDoor = true, numbering }) {
  const cols = pattern.length;
  const seats = patternRows({ pattern, rowCount: rows, startRow: 1, numbering });
  const elements = [
    el('driver', 0, cols - 1, { label: 'Driver' }),
    el('front_door', 0, 0, { label: 'Door' }),
  ];
  // one extra row behind the last seat row holds the rear door / emergency exit
  if (withRearDoor) elements.push(el('rear_door', rows + 1, 0, { label: 'Rear door' }));
  elements.push(el('emergency_exit', rows + 1, cols - 1, { label: 'Exit' }));
  return { name, vehicleType, rows: rows + 2, columns: cols, seats, elements };
}

const templates = {
  tourist_2x2: (o = {}) => bus({ pattern: 'SS_SS', rows: o.rows || 10, name: 'Tourist Bus 2+2', vehicleType: 'tourist_bus', numbering: o.numbering }),
  tourist_2x1: (o = {}) => bus({ pattern: 'SS_S', rows: o.rows || 10, name: 'Tourist Bus 2+1', vehicleType: 'tourist_bus', numbering: o.numbering }),
  deluxe_2x2: (o = {}) => bus({ pattern: 'SS_SS', rows: o.rows || 11, name: 'Deluxe Bus 2+2', vehicleType: 'deluxe_bus', numbering: o.numbering }),
  local_2x3: (o = {}) => {
    const l = bus({ pattern: 'SS_SSS', rows: o.rows || 9, name: 'Local Bus 2+3', vehicleType: 'local_bus', numbering: o.numbering });
    return l;
  },

  hiace_1x2: (o = {}) => {
    const rows = o.rows || 4; // rows of passengers behind the front row
    const pattern = 'S_SS';
    const seats = [seat(0, 0, 'F1', { position: 'window', category: 'premium', pricingCategory: 'premium' })]; // front passenger
    seats.push(...patternRows({ pattern, rowCount: rows, startRow: 1 }));
    const elements = [
      el('driver', 0, 3, { label: 'Driver' }),
      el('side_door', rows + 1, 1, { label: 'Door' }),
    ];
    return { name: 'HiAce 1+2', vehicleType: 'hiace', rows: rows + 2, columns: 4, seats, elements };
  },
  hiace_2x2: (o = {}) => {
    const rows = o.rows || 4;
    const seats = [seat(0, 0, 'F1', { position: 'window', category: 'premium', pricingCategory: 'premium' })];
    seats.push(...patternRows({ pattern: 'SS_SS', rowCount: rows, startRow: 1 }));
    const elements = [el('driver', 0, 4, { label: 'Driver' })];
    return { name: 'HiAce / Microbus 2+2', vehicleType: 'microbus', rows: rows + 1, columns: 5, seats, elements };
  },
  coaster: (o = {}) => {
    const l = bus({ pattern: 'SS_S', rows: o.rows || 7, name: 'Coaster 2+1', vehicleType: 'coaster', withRearDoor: false });
    return l;
  },

  sleeper: (o = {}) => {
    const decks = o.rows || 5; // rows per deck, pattern: 2 lower berth columns (single + double)
    const seats = [];
    const elements = [el('driver', 0, 3, { label: 'Driver' }), el('front_door', 0, 0, { label: 'Door' })];
    const pattern = 'S_SS';
    for (let r = 0; r < decks; r++) {
      let n = 0;
      for (let c = 0; c < pattern.length; c++) {
        if (pattern[c] !== 'S') continue;
        n += 1;
        seats.push(seat(1 + r, c, `L${r * 3 + n}`, {
          kind: 'berth', category: 'lower_sleeper', pricingCategory: 'lower_sleeper',
          position: c === 0 || c === 3 ? 'window' : 'aisle',
        }));
      }
    }
    elements.push(el('label', decks + 1, 0, { label: 'UPPER DECK', colSpan: 4 }));
    for (let r = 0; r < decks; r++) {
      let n = 0;
      for (let c = 0; c < pattern.length; c++) {
        if (pattern[c] !== 'S') continue;
        n += 1;
        seats.push(seat(decks + 2 + r, c, `U${r * 3 + n}`, {
          kind: 'berth', category: 'upper_sleeper', pricingCategory: 'upper_sleeper',
          position: c === 0 || c === 3 ? 'window' : 'aisle',
        }));
      }
    }
    return { name: 'Sleeper Bus (Upper/Lower)', vehicleType: 'sleeper_bus', rows: decks * 2 + 2, columns: 4, seats, elements };
  },

  car: (o = {}) => {
    const seats = [seat(0, 0, 'F1', { position: 'window', category: 'premium', pricingCategory: 'premium' })];
    seats.push(seat(1, 0, 'R1', { position: 'window' }), seat(1, 1, 'R2', { position: 'middle' }), seat(1, 2, 'R3', { position: 'window' }));
    if (o.extraRow) seats.push(seat(2, 0, 'X1', { position: 'window' }), seat(2, 1, 'X2'), seat(2, 2, 'X3', { position: 'window' }));
    return {
      name: o.extraRow ? 'SUV (3 rows)' : 'Car / Taxi',
      vehicleType: o.extraRow ? 'suv' : 'car',
      rows: o.extraRow ? 3 : 2, columns: 3, seats,
      elements: [el('driver', 0, 2, { label: 'Driver' })],
    };
  },
  suv: () => templates.car({ extraRow: true }),
};

const TEMPLATE_LIST = [
  ['tourist_2x2', 'Tourist bus 2+2'], ['tourist_2x1', 'Tourist bus 2+1'], ['deluxe_2x2', 'Deluxe bus 2+2'],
  ['local_2x3', 'Local bus 2+3'], ['hiace_1x2', 'HiAce 1+2'], ['hiace_2x2', 'HiAce / microbus 2+2'],
  ['coaster', 'Coaster 2+1'], ['sleeper', 'Sleeper (upper/lower)'], ['car', 'Car / taxi'], ['suv', 'SUV'],
];

module.exports = {
  templates,
  TEMPLATE_LIST,
  build: (key, opts) => (templates[key] ? templates[key](opts) : null),
};

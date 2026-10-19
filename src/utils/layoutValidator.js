/**
 * Layout validation. Returns { valid, errors: [{code, message, ids[]}], summary }.
 * ids lets the designer highlight offending elements.
 */
function validateLayout(layout) {
  const errors = [];
  const add = (code, message, ids = []) => errors.push({ code, message, ids });

  const rows = Number(layout.rows);
  const columns = Number(layout.columns);
  if (!Number.isInteger(rows) || rows < 1 || rows > 60) add('GRID_ROWS', 'Rows must be an integer between 1 and 60');
  if (!Number.isInteger(columns) || columns < 1 || columns > 12) add('GRID_COLS', 'Columns must be an integer between 1 and 12');

  const seats = layout.seats || [];
  const elements = layout.elements || [];

  const seatIds = new Map();
  const seatNos = new Map();
  const occupied = new Map(); // "r,c" -> id

  const inGrid = (r, c, rs = 1, cs = 1) => r >= 0 && c >= 0 && r + rs <= rows && c + cs <= columns;

  seats.forEach((s) => {
    if (!s.seatId || !String(s.seatId).trim()) add('SEAT_ID', 'Every seat needs a seat ID', [s.seatId]);
    if (!s.seatNumber || !String(s.seatNumber).trim()) add('SEAT_NO', `Seat ${s.seatId} has no seat number`, [s.seatId]);
    seatIds.set(s.seatId, (seatIds.get(s.seatId) || 0) + 1);
    seatNos.set(s.seatNumber, (seatNos.get(s.seatNumber) || 0) + 1);
    if (!Number.isInteger(s.row) || !Number.isInteger(s.col) || !inGrid(s.row, s.col)) {
      add('SEAT_POS', `Seat ${s.seatNumber || s.seatId} is outside the ${rows}x${columns} grid`, [s.seatId]);
      return;
    }
    const k = `${s.row},${s.col}`;
    if (occupied.has(k)) add('OVERLAP', `Seat ${s.seatNumber} overlaps ${occupied.get(k)} at row ${s.row + 1}, column ${s.col + 1}`, [s.seatId, occupied.get(k)]);
    else occupied.set(k, s.seatId);
  });

  for (const [id, n] of seatIds) if (n > 1) add('DUP_SEAT_ID', `Seat ID "${id}" is used ${n} times`, [id]);
  for (const [no, n] of seatNos) if (n > 1) {
    add('DUP_SEAT_NO', `Seat number "${no}" is used ${n} times`, seats.filter((s) => s.seatNumber === no).map((s) => s.seatId));
  }

  const elIds = new Set();
  elements.forEach((e) => {
    if (elIds.has(e.id) || seatIds.has(e.id)) add('DUP_ELEMENT_ID', `Element ID "${e.id}" is duplicated`, [e.id]);
    elIds.add(e.id);
    const rs = e.rowSpan || 1;
    const cs = e.colSpan || 1;
    if (!inGrid(e.row, e.col, rs, cs)) {
      add('ELEMENT_POS', `Element ${e.type} (${e.id}) is outside the grid`, [e.id]);
      return;
    }
    // aisles, empty space, labels and doors may sit alongside seats only if not on the same cell as a seat/driver
    for (let r = e.row; r < e.row + rs; r++) {
      for (let c = e.col; c < e.col + cs; c++) {
        const k = `${r},${c}`;
        if (occupied.has(k)) add('OVERLAP', `${e.type} (${e.id}) overlaps ${occupied.get(k)} at row ${r + 1}, column ${c + 1}`, [e.id, occupied.get(k)]);
        else occupied.set(k, e.id);
      }
    }
  });

  const drivers = elements.filter((e) => e.type === 'driver');
  const bookable = seats.filter((s) => s.bookable && s.active);
  if (bookable.length === 0) add('NO_BOOKABLE', 'Layout must contain at least one bookable passenger seat');
  if (drivers.length > 1) add('MULTI_DRIVER', 'Only one driver position is allowed', drivers.map((d) => d.id));

  return {
    valid: errors.length === 0,
    errors,
    summary: {
      rows, columns,
      totalSeats: seats.length,
      bookableSeats: bookable.length,
      passengerCapacity: bookable.length, // drivers/staff are elements, never counted
    },
  };
}

module.exports = { validateLayout };

const { Router } = require('express');
const { param } = require('express-validator');
const seatService = require('../services/seatService');
const asyncHandler = require('../utils/asyncHandler');
const { validate } = require('../middleware/validate');

const r = Router();
// Public, read-only: the exact saved layout + live per-trip seat state. Same data for passengers and counters.
r.get('/trip/:tripId', validate([param('tripId').isMongoId()]), asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, data: await seatService.getSeatMap(req.params.tripId) });
}));

module.exports = r;

const jwt = require('jsonwebtoken');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { jwtAccessSecret } = require('../config/env');

function extractToken(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

async function loadUser(token) {
  let payload;
  try {
    payload = jwt.verify(token, jwtAccessSecret);
  } catch {
    throw ApiError.unauthorized('Invalid or expired token');
  }
  const user = await User.findById(payload.sub);
  if (!user || !user.isActive) throw ApiError.unauthorized('Account not found or disabled');
  return user;
}

// Requires a valid token. Role always comes from the database, never from the client.
const authenticate = asyncHandler(async (req, _res, next) => {
  const token = extractToken(req);
  if (!token) throw ApiError.unauthorized();
  req.user = await loadUser(token);
  next();
});

// Attaches req.user when a token is present, otherwise continues anonymously.
const optionalAuth = asyncHandler(async (req, _res, next) => {
  const token = extractToken(req);
  if (token) req.user = await loadUser(token);
  next();
});

const authorize = (...roles) => (req, _res, next) => {
  if (!req.user) return next(ApiError.unauthorized());
  if (!roles.includes(req.user.role)) return next(ApiError.forbidden());
  next();
};

// Counter staff must be bound to an active counter assigned by an admin.
const requireCounter = asyncHandler(async (req, _res, next) => {
  if (req.user.role === 'admin') return next();
  if (req.user.role !== 'counter' || !req.user.counterId) throw ApiError.forbidden('No counter assigned to this account');
  const Counter = require('../models/Counter');
  const counter = await Counter.findById(req.user.counterId);
  if (!counter || counter.status !== 'active') throw ApiError.forbidden('Your counter is inactive');
  req.counter = counter;
  next();
});

module.exports = { authenticate, optionalAuth, authorize, requireCounter };

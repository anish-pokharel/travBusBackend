const { isProd } = require('../config/env');

exports.notFound = (req, _res, next) => {
  const ApiError = require('../utils/ApiError');
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
};

// eslint-disable-next-line no-unused-vars
exports.errorHandler = (err, req, res, _next) => {
  let status = err.status || 500;
  let message = err.message || 'Internal server error';
  let details = err.details;

  if (err.name === 'ValidationError') {
    status = 400;
    details = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
    message = 'Validation failed';
  } else if (err.name === 'CastError') {
    status = 400;
    message = `Invalid ${err.path}`;
  } else if (err.code === 11000) {
    status = 409;
    const field = Object.keys(err.keyPattern || {})[0] || 'field';
    message = `Duplicate value for ${field}`;
  } else if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    status = 401;
    message = 'Invalid or expired token';
  }

  if (status >= 500) console.error(err);

  res.status(status).json({
    success: false,
    message: status >= 500 && isProd ? 'Internal server error' : message,
    ...(details ? { details } : {}),
  });
};


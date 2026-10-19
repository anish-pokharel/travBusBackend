const { validationResult } = require('express-validator');
const ApiError = require('../utils/ApiError');

exports.validate = (rules) => [
  ...rules,
  (req, _res, next) => {
    const result = validationResult(req);
    if (result.isEmpty()) return next();
    const details = result.array().map((e) => ({ field: e.path, message: e.msg }));
    next(ApiError.badRequest('Validation failed', details));
  },
];

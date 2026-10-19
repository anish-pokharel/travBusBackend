class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
  static badRequest(m, d) { return new ApiError(400, m, d); }
  static unauthorized(m = 'Authentication required') { return new ApiError(401, m); }
  static forbidden(m = 'You do not have permission for this action') { return new ApiError(403, m); }
  static notFound(m = 'Resource not found') { return new ApiError(404, m); }
  static conflict(m, d) { return new ApiError(409, m, d); }
}
module.exports = ApiError;

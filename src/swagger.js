// Compact OpenAPI 3 description generated from a table so it stays easy to maintain.
const R = (method, path, summary, auth = 'bearer', body) => ({ method, path, summary, auth, body });

const endpoints = [
  R('post', '/auth/register', 'Register a passenger account', null, { name: 'string', email: 'string', phone: 'string', password: 'string' }),
  R('post', '/auth/login', 'Login (sets refresh cookie, returns access token)', null, { email: 'string', password: 'string' }),
  R('post', '/auth/refresh', 'Rotate refresh token and get a new access token', null),
  R('post', '/auth/logout', 'Logout', null),
  R('get', '/auth/me', 'Current user'),
  R('patch', '/auth/profile', 'Update own profile'),
  R('post', '/auth/change-password', 'Change password'),
  R('post', '/auth/forgot-password', 'Request password reset', null),
  R('post', '/auth/reset-password', 'Reset password with token', null),
  R('get', '/users', 'Admin: list users'), R('post', '/users', 'Admin: create user/staff/admin'),
  R('patch', '/users/{id}', 'Admin: update user'), R('delete', '/users/{id}', 'Admin: deactivate user'),
  R('get', '/vehicles', 'Admin: list vehicles'), R('post', '/vehicles', 'Admin: create vehicle'),
  R('patch', '/vehicles/{id}', 'Admin: update vehicle'), R('patch', '/vehicles/{id}/status', 'Admin: activate/deactivate'),
  R('get', '/vehicle-layouts', 'Admin: list layouts'), R('get', '/vehicle-layouts/templates', 'Admin: starter templates'),
  R('get', '/vehicle-layouts/templates/{key}', 'Admin: build a template'), R('post', '/vehicle-layouts/validate', 'Admin: validate layout'),
  R('post', '/vehicle-layouts', 'Admin: create layout'), R('put', '/vehicle-layouts/{id}', 'Admin: update layout (auto-versions if used by trips)'),
  R('post', '/vehicle-layouts/{id}/duplicate', 'Admin: duplicate layout'), R('delete', '/vehicle-layouts/{id}', 'Admin: archive layout'),
  R('get', '/routes', 'List routes', null), R('get', '/routes/cities', 'City list', null), R('post', '/routes', 'Admin: create route'),
  R('patch', '/routes/{id}', 'Admin: update route'), R('delete', '/routes/{id}', 'Admin: delete route'),
  R('get', '/trips/search', 'Search trips (from,to,date,type,...)', null), R('get', '/trips/{id}', 'Trip summary', null),
  R('get', '/trips', 'Admin: list trips'), R('get', '/trips/upcoming', 'Counter/Admin: upcoming trips'),
  R('post', '/trips', 'Admin: schedule trip (creates seat inventory)'), R('patch', '/trips/{id}', 'Admin: update trip'),
  R('post', '/trips/{id}/cancel', 'Admin: cancel trip + queue refunds'), R('post', '/trips/{id}/block-seats', 'Admin: block/unblock seats'),
  R('get', '/seats/trip/{tripId}', 'Saved layout + live seat state for a trip', null),
  R('post', '/bookings/hold', 'Passenger: hold seats (atomic)'), R('post', '/bookings/release', 'Release held seats'),
  R('post', '/bookings/checkout', 'Passenger: create booking + start eSewa/Khalti payment'),
  R('post', '/bookings/counter', 'Counter: book and collect payment'), R('get', '/bookings/mine', 'Passenger: my bookings'),
  R('get', '/bookings', 'Admin/Counter: search bookings'), R('get', '/bookings/{id}', 'Booking by id or PNR'),
  R('post', '/bookings/{id}/cancel', 'Cancel with refund policy'), R('post', '/bookings/{id}/printed', 'Record ticket print'),
  R('post', '/payments/esewa/verify', 'Verify eSewa callback server-side'), R('post', '/payments/khalti/verify', 'Verify Khalti payment server-side'),
  R('get', '/payments', 'Admin: payments'), R('get', '/refunds', 'Refunds'), R('post', '/refunds/{id}/process', 'Admin: approve/reject refund'),
  R('get', '/counters', 'Admin: counters'), R('post', '/counters', 'Admin: create counter'), R('patch', '/counters/{id}', 'Admin: update counter'),
  R('post', '/counters/{id}/staff', 'Admin: assign staff'), R('get', '/counters/me/dashboard', 'Counter dashboard'), R('get', '/counters/me/daily-closing', 'Counter daily closing'),
  R('get', '/counter-staff', 'Admin: staff assignments'),
  R('get', '/tickets/verify/{code}', 'Public QR verification', null), R('post', '/tickets/verify', 'Counter: verify ticket'),
  R('post', '/tickets/check-in', 'Counter: check in ticket'), R('get', '/tickets/{pnr}/qr', 'QR image'),
  R('get', '/reports/dashboard', 'Admin dashboard'), R('get', '/reports/sales', 'Sales (groupBy=day|week|month|year, format=csv)'),
  R('get', '/reports/breakdown/{dim}', 'Revenue by route|vehicle|counter|staff|source'), R('get', '/reports/payment-methods', 'Payment method summary'),
  R('get', '/reports/cancellations', 'Cancellation & refund report'), R('get', '/reports/occupancy', 'Occupancy report'),
  R('get', '/notifications', 'My notifications'), R('get', '/audit-logs', 'Admin: audit logs'),
  R('get', '/settings', 'Admin: settings'), R('put', '/settings', 'Admin: update settings'), R('get', '/settings/public', 'Public policy', null),
];

const paths = {};
endpoints.forEach((e) => {
  (paths[e.path] ||= {})[e.method] = {
    summary: e.summary,
    ...(e.auth ? { security: [{ bearerAuth: [] }] } : {}),
    ...(e.path.includes('{') ? { parameters: [...e.path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } })) } : {}),
    responses: { 200: { description: 'OK' }, 400: { description: 'Validation error' }, 401: { description: 'Unauthenticated' }, 403: { description: 'Forbidden' }, 409: { description: 'Conflict (e.g. seat taken)' } },
  };
});

module.exports = {
  openapi: '3.0.3',
  info: { title: 'Nepal Vehicle Ticket Booking API', version: '1.0.0', description: 'Roles: admin, passenger, counter. All responses: { success, data?, message?, details? }' },
  servers: [{ url: '/api' }],
  components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
  paths,
};

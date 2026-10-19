require('dotenv').config();

const required = ['MONGODB_URI', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'TICKET_SECRET'];
const missing = required.filter((k) => !process.env[k] || process.env[k].startsWith('change_me'));
if (missing.length) {
  console.error(`Missing or placeholder environment variables: ${missing.join(', ')}`);
  console.error('Copy .env.example to .env and fill the values.');
  process.exit(1);
}

module.exports = {
  env: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: parseInt(process.env.PORT || '5000', 10),
  mongoUri: process.env.MONGODB_URI,
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
  ticketSecret: process.env.TICKET_SECRET,
  accessTtl: process.env.ACCESS_TOKEN_TTL || '15m',
  refreshDays: parseInt(process.env.REFRESH_TOKEN_DAYS || '7', 10),
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:4200').split(',').map((s) => s.trim()),
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:4200',
  cookieSameSite: process.env.COOKIE_SAMESITE || 'lax',
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  holdMinutes: parseInt(process.env.SEAT_HOLD_MINUTES || '10', 10),
  esewa: {
    productCode: process.env.ESEWA_PRODUCT_CODE || 'EPAYTEST',
    secret: process.env.ESEWA_SECRET_KEY || '',
    formUrl: process.env.ESEWA_FORM_URL,
    statusUrl: process.env.ESEWA_STATUS_URL,
  },
  khalti: {
    secret: process.env.KHALTI_SECRET_KEY || '',
    baseUrl: process.env.KHALTI_BASE_URL || 'https://dev.khalti.com/api/v2',
  },
};

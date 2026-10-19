const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const hpp = require('hpp');
const cookieParser = require('cookie-parser');
const mongoSanitize = require('express-mongo-sanitize');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');
const cfg = require('./config/env');
const { notFound, errorHandler } = require('./middleware/error');
const { authenticate, authorize } = require('./middleware/auth');
const asyncHandler = require('./utils/asyncHandler');
const misc = require('./routes/misc');
const CounterStaffAssignment = require('./models/CounterStaffAssignment');
const swaggerSpec = require('./swagger');

const app = express();
app.set('trust proxy', 1); // behind Render/Railway/Nginx so rate-limit sees the real IP
app.disable('x-powered-by');

// CSP: the SPA is same-origin; eSewa needs a cross-origin form POST (form-action) so its origin is allowed explicitly.
const formOrigin = (u) => { try { return new URL(u).origin; } catch { return null; } };
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'", formOrigin(cfg.esewa.formUrl)].filter(Boolean),
      objectSrc: ["'none'"],
      upgradeInsecureRequests: cfg.isProd ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(cors({
  origin(origin, cb) {
    if (!origin || cfg.corsOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
}));
app.use(compression());
if (!cfg.isProd) app.use(morgan('dev'));
app.use(express.json({ limit: '200kb' }));
app.use(cookieParser());
app.use(mongoSanitize());
app.use(hpp());

app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false, message: { success: false, message: 'Too many requests, slow down.' } }));
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { success: false, message: 'Too many attempts, try again later.' } });
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/reset-password', authLimiter);

app.get('/api/health', (_req, res) => res.json({ success: true, status: 'ok', time: new Date() }));
if (!cfg.isProd || process.env.ENABLE_SWAGGER === 'true') app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/vehicles', require('./routes/vehicles'));
app.use('/api/vehicle-layouts', require('./routes/vehicleLayouts'));
app.use('/api/routes', require('./routes/routes'));
app.use('/api/trips', require('./routes/trips'));
app.use('/api/seats', require('./routes/seats'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/refunds', require('./routes/refunds'));
app.use('/api/counters', require('./routes/counters'));
app.get('/api/counter-staff', authenticate, authorize('admin'), asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await CounterStaffAssignment.find({ active: true }).populate('userId', 'name email').populate('counterId', 'name code') });
}));
app.use('/api/tickets', require('./routes/tickets'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/notifications', misc.notifications);
app.use('/api/audit-logs', misc.auditLogs);
app.use('/api/settings', misc.settings);

// Serve the built Angular app (single-service hosting). Skipped when the dist folder is absent (API-only hosting).
const dist = process.env.FRONTEND_DIST || path.join(__dirname, '../../frontend/dist/frontend/browser');
if (fs.existsSync(path.join(dist, 'index.html'))) {
  app.use(express.static(dist, { index: false, maxAge: '1y', setHeaders: (res, f) => { if (/(index\.html|env\.js)$/.test(f)) res.setHeader('Cache-Control', 'no-store'); } }));
  app.get(/^\/(?!api\/).*/, (_req, res) => { res.setHeader('Cache-Control', 'no-store'); res.sendFile(path.join(dist, 'index.html')); });
}

app.use(notFound);
app.use(errorHandler);

module.exports = app;

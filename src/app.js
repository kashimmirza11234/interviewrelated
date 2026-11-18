const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');
const { env } = require('./config');
const { notFound, errorHandler } = require('./middleware/error');
const openapiSpec = require('./openapi');

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '100kb' }));

// Brute-force protection on the credential endpoints only. (Behind a reverse proxy, also set
// app.set('trust proxy', ...) so the limiter sees real client IPs.)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env === 'test',
});

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/api-docs/openapi.json', (_req, res) => res.json(openapiSpec));
app.use(
  '/api-docs',
  (_req, res, next) => {
    // Swagger UI uses inline styles; keep this relaxed policy limited to its own routes.
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; base-uri 'self'; font-src 'self' https: data:; form-action 'self'; " +
        "frame-ancestors 'self'; img-src 'self' data:; object-src 'none'; script-src 'self'; " +
        "style-src 'self' 'unsafe-inline'"
    );
    next();
  },
  swaggerUi.serve,
  swaggerUi.setup(openapiSpec, {
    customSiteTitle: 'Secure Notes API',
    swaggerOptions: { persistAuthorization: true },
  })
);
app.use('/api/auth', authLimiter, require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/notes', require('./routes/notes'));
app.use('/api/posts', require('./routes/posts'));

app.use('/api', notFound);
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(errorHandler);

module.exports = app;

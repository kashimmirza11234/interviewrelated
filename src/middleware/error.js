const mongoose = require('mongoose');
const { env } = require('../config');

const notFound = (_req, res) => res.status(404).json({ error: 'Not found' });

// Express 5 forwards rejected promises from async handlers here automatically.
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, _req, res, _next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Payload too large' });
  // The only unique index is users.email.
  if (err.code === 11000) return res.status(409).json({ error: 'Email already in use' });
  if (err instanceof mongoose.Error.ValidationError) {
    return res.status(400).json({ error: 'Validation failed', details: Object.keys(err.errors) });
  }
  if (err instanceof mongoose.Error.CastError) return res.status(400).json({ error: 'Invalid id' });

  console.error(err); // full detail stays in the server log...
  res.status(500).json({ error: env === 'production' ? 'Internal server error' : err.message });
};

module.exports = { notFound, errorHandler };

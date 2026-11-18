require('dotenv').config();

const env = process.env.NODE_ENV || 'development';
const jwtSecret = process.env.JWT_SECRET;

// Fail fast: a missing/short secret must never silently fall back to a default.
if (!jwtSecret || jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be set and at least 32 characters long');
}

module.exports = {
  env,
  port: Number(process.env.PORT) || 3000,
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/secure_notes',
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h',
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS) || 12,
};

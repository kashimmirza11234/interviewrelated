const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { jwtSecret, jwtExpiresIn } = require('../config');

const signToken = (user) =>
  jwt.sign({ sub: user.id }, jwtSecret, { algorithm: 'HS256', expiresIn: jwtExpiresIn });

const unauthorized = (res) => res.status(401).json({ error: 'Authentication required' });

async function authenticate(req, res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) return unauthorized(res);

  let payload;
  try {
    // Pin the algorithm: rejects `alg: none` and algorithm-confusion tokens.
    payload = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
  } catch {
    return unauthorized(res);
  }
  if (typeof payload.sub !== 'string' || !/^[0-9a-fA-F]{24}$/.test(payload.sub)) {
    return unauthorized(res);
  }

  // The role is read from the DB on every request, not trusted from the token. So a deleted user
  // or a demoted admin loses access immediately instead of when the token expires.
  // (findById -> built-in _id index.)
  const user = await User.findById(payload.sub);
  if (!user) return unauthorized(res);

  req.user = user;
  next();
}

const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Forbidden' });

module.exports = { authenticate, requireRole, signToken };

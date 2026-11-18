const router = require('express').Router();
const { z } = require('zod');
const User = require('../models/User');
const validate = require('../middleware/validate');
const { authenticate, signToken } = require('../middleware/auth');
const { hashPassword, verifyPassword, DUMMY_HASH } = require('../utils/password');
const S = require('../utils/schemas');

// Public registration ALWAYS creates role "user". `role` is not an accepted field (strictObject
// rejects it), so nobody can self-register as admin. Admins are created by the seed script or by
// an existing admin via POST /api/users.
router.post(
  '/register',
  validate({
    body: z.strictObject({
      name: S.name,
      email: S.email,
      password: S.password,
      interests: S.interests.optional(),
    }),
  }),
  async (req, res) => {
    const { name, email, password, interests } = req.valid.body;
    const user = await User.create({ name, email, interests, passwordHash: await hashPassword(password) });
    res.status(201).json({ user, token: signToken(user) });
  }
);

router.post(
  '/login',
  validate({ body: z.strictObject({ email: S.email, password: z.string().min(1).max(1024) }) }),
  async (req, res) => {
    const { email, password } = req.valid.body;
    // findOne({ email }) -> unique { email: 1 } index
    const user = await User.findOne({ email }).select('+passwordHash');
    // Always run one bcrypt compare, and return one generic message, whichever check failed.
    const ok = await verifyPassword(password, user ? user.passwordHash : DUMMY_HASH);
    if (!user || !ok) return res.status(401).json({ error: 'Invalid email or password' });
    res.json({ user, token: signToken(user) });
  }
);

router.get('/me', authenticate, (req, res) => res.json({ user: req.user }));

// Self-service profile edit: name + interests only. Role/email/password changes are admin-only.
router.put(
  '/me',
  authenticate,
  validate({
    body: z
      .strictObject({ name: S.name.optional(), interests: S.interests.optional() })
      .refine((b) => Object.keys(b).length > 0, 'Provide at least one field'),
  }),
  async (req, res) => {
    Object.assign(req.user, req.valid.body);
    await req.user.save();
    res.json({ user: req.user });
  }
);

module.exports = router;

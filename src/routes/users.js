const router = require('express').Router();
const { z } = require('zod');
const User = require('../models/User');
const Note = require('../models/Note');
const Post = require('../models/Post');
const { interestsPipeline, userPostsPipeline } = require('../queries');
const validate = require('../middleware/validate');
const { authenticate, requireRole } = require('../middleware/auth');
const { hashPassword } = require('../utils/password');
const { paginationQuery, toSkip, pageMeta } = require('../utils/pagination');
const S = require('../utils/schemas');

const idParams = z.strictObject({ id: S.objectId });

/* ───────────────────────────────────────────────────────────────────────────
 * SCENARIO 2 — all posts of one user, ONE aggregation pipeline with $lookup.
 * Public: posts are "visible to everyone", so this route is registered BEFORE authenticate.
 * ─────────────────────────────────────────────────────────────────────────── */
router.get(
  '/:id/posts',
  validate({ params: idParams, query: z.strictObject(paginationQuery) }),
  async (req, res) => {
    const { id } = req.valid.params;
    const { page, limit } = req.valid.query;

    const [doc] = await User.aggregate(userPostsPipeline({ id, page, limit }));

    if (!doc) return res.status(404).json({ error: 'User not found' });

    const hasMore = doc.posts.length > limit;
    const posts = doc.posts.slice(0, limit).map(({ _id, ...rest }) => ({ id: _id, ...rest }));
    res.json({ user: { id: doc._id, name: doc.name }, posts, pagination: { page, limit, hasMore } });
  }
);

// Everything below requires a valid token.
router.use(authenticate);

/* ───────────────────────────────────────────────────────────────────────────
 * SCENARIO 1 — users grouped by interest, EXACTLY ONE User.aggregate() call.
 * (Admin-only: it lists other users' names.) Declared before '/:id' so "interests" isn't an id.
 * ─────────────────────────────────────────────────────────────────────────── */
router.get(
  '/interests',
  requireRole('admin'),
  validate({
    query: z.strictObject({
      ...paginationQuery,
      interest: z.string().trim().toLowerCase().min(1).max(30).optional(),
    }),
  }),
  async (req, res) => {
    const { page, limit, interest } = req.valid.query;

    const pipeline = interestsPipeline({ page, limit, interest });
    const [out] = await User.aggregate(pipeline);
    const total = out.meta[0]?.total ?? 0;
    res.json({ data: out.groups, pagination: pageMeta(page, limit, total) });
  }
);

/* ───────────────────────────── Admin: manage users ───────────────────────────── */

router.post(
  '/',
  requireRole('admin'),
  validate({
    body: z.strictObject({
      name: S.name,
      email: S.email,
      password: S.password,
      role: z.enum(['user', 'admin']).default('user'),
      interests: S.interests.optional(),
    }),
  }),
  async (req, res) => {
    const { password, ...rest } = req.valid.body;
    const user = await User.create({ ...rest, passwordHash: await hashPassword(password) });
    res.status(201).json({ user });
  }
);

router.get(
  '/',
  requireRole('admin'),
  validate({ query: z.strictObject(paginationQuery) }),
  async (req, res) => {
    const { page, limit } = req.valid.query;
    const [users, total] = await Promise.all([
      // Sorted by _id desc -> built-in _id index, no extra index needed.
      User.find().sort({ _id: -1 }).skip(toSkip(page, limit)).limit(limit),
      User.estimatedDocumentCount(), // metadata read, O(1); no filter so it is exact enough for paging
    ]);
    res.json({ data: users, pagination: pageMeta(page, limit, total) });
  }
);

// Profile read: an admin can read anyone; a user can read only themselves. (_id index)
router.get('/:id', validate({ params: idParams }), async (req, res) => {
  const { id } = req.valid.params;
  if (req.user.role !== 'admin' && req.user.id !== id) return res.status(403).json({ error: 'Forbidden' });
  const user = await User.findById(id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

router.put(
  '/:id',
  requireRole('admin'),
  validate({
    params: idParams,
    body: z
      .strictObject({
        name: S.name.optional(),
        email: S.email.optional(),
        password: S.password.optional(),
        role: z.enum(['user', 'admin']).optional(),
        interests: S.interests.optional(),
      })
      .refine((b) => Object.keys(b).length > 0, 'Provide at least one field'),
  }),
  async (req, res) => {
    const { id } = req.valid.params;
    const { password, ...fields } = req.valid.body;

    // Stops an admin locking themselves out; another admin must change their role.
    if (id === req.user.id && fields.role && fields.role !== 'admin') {
      return res.status(400).json({ error: 'You cannot remove your own admin role' });
    }
    const user = await User.findById(id).select('+passwordHash');
    if (!user) return res.status(404).json({ error: 'User not found' });

    Object.assign(user, fields);
    if (password) user.passwordHash = await hashPassword(password);
    await user.save(); // duplicate email -> E11000 -> 409 via the error handler
    res.json({ user });
  }
);

router.delete('/:id', requireRole('admin'), validate({ params: idParams }), async (req, res) => {
  const { id } = req.valid.params;
  if (id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });

  const user = await User.findByIdAndDelete(id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Cascade. These use the { owner, _id } and { author, _id } indexes (prefix match).
  // Not wrapped in a transaction: standalone MongoDB has none. The user is deleted FIRST so they can
  // no longer authenticate; any crash mid-way leaves only harmless orphans, which a retry cleans up.
  await Promise.all([Note.deleteMany({ owner: user._id }), Post.deleteMany({ author: user._id })]);
  res.status(204).end();
});

module.exports = router;

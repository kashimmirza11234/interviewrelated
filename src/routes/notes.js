const router = require('express').Router();
const { z } = require('zod');
const Note = require('../models/Note');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { paginationQuery, toSkip, pageMeta } = require('../utils/pagination');
const S = require('../utils/schemas');

router.use(authenticate);

const idParams = z.strictObject({ id: S.objectId });
const title = z.string().trim().min(1).max(200);
const content = z.string().max(20000);

router.post(
  '/',
  validate({ body: z.strictObject({ title, content: content.default('') }) }),
  async (req, res) => {
    const note = await Note.create({ ...req.valid.body, owner: req.user._id });
    res.status(201).json({ note });
  }
);

// User  -> only their own notes.
// Admin -> everyone's notes (optionally narrowed with ?owner=<userId>).
router.get(
  '/',
  validate({ query: z.strictObject({ ...paginationQuery, owner: S.objectId.optional() }) }),
  async (req, res) => {
    const { page, limit, owner } = req.valid.query;
    const isAdmin = req.user.role === 'admin';

    if (!isAdmin && owner && owner !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const filter = isAdmin ? (owner ? { owner } : {}) : { owner: req.user._id };

    const [notes, total] = await Promise.all([
      // owner filter + _id desc  -> { owner: 1, _id: -1 } index, no in-memory sort
      // no filter  + _id desc    -> built-in _id index (backward scan)
      Note.find(filter).sort({ _id: -1 }).skip(toSkip(page, limit)).limit(limit),
      Object.keys(filter).length ? Note.countDocuments(filter) : Note.estimatedDocumentCount(),
    ]);
    res.json({ data: notes, pagination: pageMeta(page, limit, total) });
  }
);

// Read one: owner or admin. Others get 404 (not 403) so note ids can't be probed for existence.
router.get('/:id', validate({ params: idParams }), async (req, res) => {
  const note = await Note.findById(req.valid.params.id); // _id index
  if (!note || (req.user.role !== 'admin' && !note.owner.equals(req.user._id))) {
    return res.status(404).json({ error: 'Note not found' });
  }
  res.json({ note });
});

// Update/delete: ONLY the owner, admins included. The spec gives admins the right to VIEW all notes,
// not to modify them. Ownership is part of the filter, so there is no read-then-write race.
router.put(
  '/:id',
  validate({
    params: idParams,
    body: z
      .strictObject({ title: title.optional(), content: content.optional() })
      .refine((b) => Object.keys(b).length > 0, 'Provide at least one field'),
  }),
  async (req, res) => {
    const note = await Note.findOneAndUpdate(
      { _id: req.valid.params.id, owner: req.user._id },
      { $set: req.valid.body },
      { returnDocument: 'after', runValidators: true }
    );
    if (!note) return res.status(404).json({ error: 'Note not found' });
    res.json({ note });
  }
);

router.delete('/:id', validate({ params: idParams }), async (req, res) => {
  const note = await Note.findOneAndDelete({ _id: req.valid.params.id, owner: req.user._id });
  if (!note) return res.status(404).json({ error: 'Note not found' });
  res.status(204).end();
});

module.exports = router;

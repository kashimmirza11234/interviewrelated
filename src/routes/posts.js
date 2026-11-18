const router = require('express').Router();
const { z } = require('zod');
const Post = require('../models/Post');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');

// Creating a post needs a login. Reading a user's posts is public: GET /api/users/:id/posts.
router.post(
  '/',
  authenticate,
  validate({
    body: z.strictObject({
      title: z.string().trim().min(1).max(200),
      body: z.string().max(20000).default(''),
    }),
  }),
  async (req, res) => {
    const post = await Post.create({ ...req.valid.body, author: req.user._id });
    res.status(201).json({ post });
  }
);

module.exports = router;

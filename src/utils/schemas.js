const { z } = require('zod');

// Strict 24-hex check. (mongoose.isValidObjectId also accepts any 12-char string, which we do not want.)
const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

const email = z.string().trim().toLowerCase().max(254).pipe(z.email());

// bcrypt only uses the first 72 BYTES, so cap there instead of silently truncating.
const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .refine((p) => Buffer.byteLength(p, 'utf8') <= 72, 'Password must be at most 72 bytes');

const name = z.string().trim().min(1).max(100);

// Normalised so "Chess", " chess " and "chess" group together in the aggregation.
const interests = z
  .array(z.string().trim().toLowerCase().min(1).max(30))
  .max(20)
  .transform((arr) => [...new Set(arr)]);

module.exports = { objectId, email, password, name, interests };

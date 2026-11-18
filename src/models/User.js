const { Schema, model } = require('mongoose');

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    // select:false -> the hash is never loaded unless explicitly requested (login / password change).
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    interests: { type: [String], default: [] },
  },
  { timestamps: true, versionKey: false }
);

/*
 * INDEXES (every one is justified; see README "Indexing strategy")
 *
 * 1. { email: 1 } unique
 *    - POST /auth/login          -> findOne({ email })
 *    - uniqueness on register / admin create / admin update
 *
 * 2. { interests: 1 } (multikey)
 *    - GET /users/interests?interest=chess  (Scenario 1): the $match on `interests`
 *      before $unwind can use this index instead of scanning every user.
 *
 * Deliberately NOT indexed:
 *    - _id            : automatic. Covers GET /users/:id, GET /auth/me, the JWT user
 *                       lookup, AND the admin user list (sorted by _id desc; an ObjectId
 *                       starts with a timestamp so _id order == creation order).
 *    - createdAt      : not needed, because we sort by _id instead.
 *    - role / name    : no query filters or sorts on them.
 */
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ interests: 1 });

userSchema.set('toJSON', {
  transform(_doc, ret) {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.passwordHash;
    return ret;
  },
});

module.exports = model('User', userSchema);

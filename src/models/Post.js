const { Schema, model } = require('mongoose');

const postSchema = new Schema(
  {
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    body: { type: String, default: '', maxlength: 20000 },
  },
  { timestamps: true, versionKey: false }
);

/*
 * INDEX: { author: 1, _id: -1 }
 *   - Scenario 2: the $lookup sub-pipeline matches posts by `author` and sorts by _id desc,
 *     so the join side is an index seek, not a collection scan per user.
 *   - cascade delete when a user is removed: deleteMany({ author }).
 */
postSchema.index({ author: 1, _id: -1 });

postSchema.set('toJSON', {
  transform(_doc, ret) {
    ret.id = ret._id.toString();
    delete ret._id;
    return ret;
  },
});

module.exports = model('Post', postSchema);

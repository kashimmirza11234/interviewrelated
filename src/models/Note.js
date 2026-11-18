const { Schema, model } = require('mongoose');

const noteSchema = new Schema(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    content: { type: String, default: '', maxlength: 20000 },
  },
  { timestamps: true, versionKey: false }
);

/*
 * INDEX: { owner: 1, _id: -1 }
 *   - "list my notes", newest first:  find({ owner }).sort({ _id: -1 })
 *       equality on owner + sort on _id desc is satisfied entirely by this index
 *       (no in-memory SORT stage).
 *   - admin "list notes of user X":   same query shape, same index.
 *   - cascade delete when a user is removed: deleteMany({ owner }).
 *
 * Deliberately NOT indexed:
 *   - admin "list ALL notes" is find({}).sort({ _id: -1 }) -> served by the built-in _id index.
 *   - GET/PUT/DELETE /notes/:id -> _id index (ownership is checked on the fetched doc / in the filter).
 *   - owner alone: the compound index already has `owner` as its prefix.
 */
noteSchema.index({ owner: 1, _id: -1 });

noteSchema.set('toJSON', {
  transform(_doc, ret) {
    ret.id = ret._id.toString();
    delete ret._id;
    return ret;
  },
});

module.exports = model('Note', noteSchema);

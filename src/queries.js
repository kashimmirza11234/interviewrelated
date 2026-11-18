// The two aggregation pipelines live here so that the routes AND scripts/explain.js run the
// exact same pipeline (the explain output can therefore never drift from what the API executes).
const { Types } = require('mongoose');
const Post = require('./models/Post');
const { toSkip } = require('./utils/pagination');

const MAX_USERS_PER_GROUP = 50; // keeps one response document far below the 16 MB BSON limit

/**
 * SCENARIO 1 — users grouped by interest. Run with exactly one `User.aggregate(...)` call.
 * Index used: { interests: 1 } when `interest` is given (the $match before $unwind).
 * Without a filter the view must read every user, so a collection scan is inherent to the question.
 */
function interestsPipeline({ page, limit, interest }) {
  return [
    // Optional filter, placed BEFORE $unwind so it can use the multikey index.
    ...(interest ? [{ $match: { interests: interest } }] : []),
    { $unwind: '$interests' },
    // After $unwind each user appears once per interest; keep only the requested group.
    ...(interest ? [{ $match: { interests: interest } }] : []),
    {
      $group: {
        _id: '$interests',
        count: { $sum: 1 },
        users: { $push: { id: '$_id', name: '$name' } },
      },
    },
    { $sort: { _id: 1 } },
    {
      // $facet returns the page of groups AND the total group count from ONE aggregate() call,
      // so pagination metadata needs no second query.
      $facet: {
        groups: [
          { $skip: toSkip(page, limit) },
          { $limit: limit },
          {
            $project: {
              _id: 0,
              interest: '$_id',
              count: 1,
              users: { $slice: ['$users', MAX_USERS_PER_GROUP] },
            },
          },
        ],
        meta: [{ $count: 'total' }],
      },
    },
  ];
}

/**
 * SCENARIO 2 — one user + their posts through a single $lookup. Run on the users collection.
 * Requires MongoDB 5.0+ (localField/foreignField combined with a sub-pipeline).
 *
 * Indexes used: _id (the $match) and posts { author: 1, _id: -1 } (the $lookup join + sort).
 * Measured with explain(): the equality join is an IXSCAN, sort/skip/limit are satisfied by that
 * same index, and the skipped rows are never fetched (only `limit + 1` posts are read).
 */
function userPostsPipeline({ id, page, limit }) {
  return [
    // aggregate() does NOT auto-cast, so build the ObjectId ourselves.
    { $match: { _id: new Types.ObjectId(id) } },
    {
      $lookup: {
        from: Post.collection.name,
        localField: '_id',
        foreignField: 'author',
        pipeline: [
          { $sort: { _id: -1 } },
          { $skip: toSkip(page, limit) },
          { $limit: limit + 1 }, // one extra row tells us `hasMore` without a COUNT
          { $project: { title: 1, body: 1, createdAt: 1 } },
        ],
        as: 'posts',
      },
    },
    { $project: { name: 1, posts: 1 } }, // never expose email/hash/role on a public route
  ];
}

module.exports = { interestsPipeline, userPostsPipeline };

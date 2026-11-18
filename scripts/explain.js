// Seeds a throw-away database with realistic volume and prints the query plan for EVERY query
// the API runs, so index usage is demonstrated instead of assumed.
//   npm run explain            (uses MONGODB_URI_EXPLAIN or a separate *_explain database)
const mongoose = require('mongoose');
const User = require('../src/models/User');
const Note = require('../src/models/Note');
const Post = require('../src/models/Post');
const { interestsPipeline, userPostsPipeline } = require('../src/queries');

const URI = process.env.MONGODB_URI_EXPLAIN || 'mongodb://127.0.0.1:27017/secure_notes_explain';
const N_USERS = 5000, N_NOTES = 100000, N_POSTS = 100000;
const INTERESTS = ['chess', 'reading', 'hiking', 'cooking', 'gaming', 'music', 'travel', 'art', 'running', 'coding'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// Walk any explain document (classic or SBE format) and summarise what it did.
function summarise(explain) {
  const stages = new Set(), indexes = new Set();
  let docsExamined = 0, keysExamined = 0, collScans = 0;
  const seen = new Set();
  (function walk(o) {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== 'object') return;
    if (typeof o.stage === 'string') stages.add(o.stage.toUpperCase());
    if (typeof o.indexName === 'string') indexes.add(o.indexName);
    if (Array.isArray(o.indexesUsed)) o.indexesUsed.forEach((i) => indexes.add(i));
    if (typeof o.collectionScans === 'number') collScans += o.collectionScans;
    // executionStats: top level for find(), under stages[0].$cursor for aggregate()
    if (o.executionStats && typeof o.executionStats === 'object' && !seen.has(o.executionStats)) {
      seen.add(o.executionStats);
      keysExamined += o.executionStats.totalKeysExamined ?? 0;
      docsExamined += o.executionStats.totalDocsExamined ?? 0;
    }
    // $lookup stage reports the reads it did on the joined collection itself
    if (o.$lookup && 'totalDocsExamined' in o) {
      keysExamined += o.totalKeysExamined ?? 0;
      docsExamined += o.totalDocsExamined ?? 0;
    }
    Object.values(o).forEach(walk);
  })(explain);
  return { stages: [...stages], indexes: [...indexes], docsExamined, keysExamined, collScans };
}

function verdict(r) {
  if (r.collScans > 0 || r.stages.includes('COLLSCAN')) return 'COLLECTION SCAN';
  if (r.stages.includes('SORT')) return 'index + IN-MEMORY SORT';
  return r.indexes.length ? 'index' : 'no index info';
}

(async () => {
  await mongoose.connect(URI);
  await mongoose.connection.dropDatabase();
  await Promise.all([User.init(), Note.init(), Post.init()]);

  const users = Array.from({ length: N_USERS }, (_, i) => ({
    name: `User ${i}`, email: `u${i}@x.io`, passwordHash: 'x', role: i === 0 ? 'admin' : 'user',
    interests: [...new Set(Array.from({ length: 1 + (i % 4) }, () => pick(INTERESTS)))],
  }));
  const ins = await User.insertMany(users, { ordered: false });
  const ids = ins.map((u) => u._id);
  const mk = (n, key) => Array.from({ length: n }, (_, i) => ({ [key]: ids[i % ids.length], title: `t${i}`, content: 'c' }));
  await Note.insertMany(mk(N_NOTES, 'owner'), { ordered: false });
  await Post.insertMany(mk(N_POSTS, 'author'), { ordered: false });
  console.log(`Seeded ${N_USERS} users, ${N_NOTES} notes, ${N_POSTS} posts\n`);

  const uid = ids[123], skip = 10, limit = 5;
  const cases = [
    ['login: findOne({email})',                    () => User.findOne({ email: 'u123@x.io' }).select('+passwordHash').explain('executionStats')],
    ['GET /users/:id, /auth/me, JWT lookup',       () => User.findById(uid).explain('executionStats')],
    ['admin list users (sort _id desc, paged)',    () => User.find().sort({ _id: -1 }).skip(skip).limit(limit).explain('executionStats')],
    ['user list own notes (owner + sort _id desc)',() => Note.find({ owner: uid }).sort({ _id: -1 }).skip(skip).limit(limit).explain('executionStats')],
    ['  …its page total: countDocuments({owner})', () => Note.find({ owner: uid }).explain('executionStats')],
    ['admin list ALL notes (sort _id desc, paged)',() => Note.find({}).sort({ _id: -1 }).skip(skip).limit(limit).explain('executionStats')],
    ['GET /notes/:id',                             () => Note.findById(new mongoose.Types.ObjectId()).explain('executionStats')],
    ['update/delete note ({_id, owner})',          () => Note.findOne({ _id: (new mongoose.Types.ObjectId()), owner: uid }).explain('executionStats')],
    ['cascade delete notes ({owner})',             () => Note.find({ owner: uid }).explain('executionStats')],
    ['cascade delete posts ({author})',            () => Post.find({ author: uid }).explain('executionStats')],
    ['SCENARIO 1: group by interests (no filter)', () => User.aggregate(interestsPipeline({ page: 3, limit: 5 })).explain('executionStats')],
    ['SCENARIO 1: group by interests ?interest=',  () => User.aggregate(interestsPipeline({ page: 1, limit: 5, interest: 'chess' })).explain('executionStats')],
    ['SCENARIO 2: user posts via $lookup',         () => User.aggregate(userPostsPipeline({ id: uid.toString(), page: 3, limit: 5 })).explain('executionStats')],
  ];

  const w = Math.max(...cases.map((c) => c[0].length));
  console.log('QUERY'.padEnd(w), ' RESULT                      INDEX(ES)                  keys/docs examined');
  console.log('-'.repeat(w + 85));
  for (const [label, run] of cases) {
    const r = summarise(await run());
    console.log(label.padEnd(w), ' ', verdict(r).padEnd(27), (r.indexes.join(', ') || '-').padEnd(26), `${r.keysExamined}/${r.docsExamined}`);
  }

  console.log('\nIndexes that exist:');
  for (const M of [User, Note, Post]) {
    const idx = await M.collection.indexes();
    console.log(`  ${M.collection.name.padEnd(6)}`, idx.map((i) => i.name).join(', '));
  }
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });

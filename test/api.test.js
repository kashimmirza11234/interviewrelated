process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123456';
process.env.BCRYPT_ROUNDS = '4'; // fast hashing for tests only

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const app = require('../src/app');
const User = require('../src/models/User');
const Note = require('../src/models/Note');
const Post = require('../src/models/Post');
const { hashPassword } = require('../src/utils/password');

const TEST_URI = process.env.MONGODB_URI_TEST || 'mongodb://127.0.0.1:27017/secure_notes_test';
const PW = 'Sup3r-secret-pw';
const api = () => request(app);
const auth = (t) => ({ Authorization: `Bearer ${t}` });

async function register(name, email, interests) {
  const res = await api().post('/api/auth/register').send({ name, email, password: PW, interests });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { token: res.body.token, id: res.body.user.id };
}
async function makeAdmin(email = 'admin@test.io') {
  await User.create({ name: 'Admin', email, role: 'admin', passwordHash: await hashPassword(PW) });
  const res = await api().post('/api/auth/login').send({ email, password: PW });
  assert.equal(res.status, 200);
  return { token: res.body.token, id: res.body.user.id };
}

before(async () => {
  await mongoose.connect(TEST_URI);
  await mongoose.connection.dropDatabase();
  await Promise.all([User.init(), Note.init(), Post.init()]);
});
after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe('indexes', () => {
  // Guard rail: fails if anyone adds an index that isn't in the justified set.
  it('creates exactly the justified indexes and nothing else', async () => {
    const names = async (M) => (await M.collection.indexes()).map((i) => i.name).sort();
    assert.deepEqual(await names(User), ['_id_', 'email_1', 'interests_1']);
    assert.deepEqual(await names(Note), ['_id_', 'owner_1__id_-1']);
    assert.deepEqual(await names(Post), ['_id_', 'author_1__id_-1']);
  });
  it('email is unique', async () => {
    const idx = (await User.collection.indexes()).find((i) => i.name === 'email_1');
    assert.equal(idx.unique, true);
  });
});

describe('auth', () => {
  it('registers, never returns the hash, and logs in', async () => {
    const r = await api().post('/api/auth/register').send({ name: 'Ann', email: 'Ann@Test.io ', password: PW });
    assert.equal(r.status, 201);
    assert.equal(r.body.user.email, 'ann@test.io'); // normalised
    assert.equal(r.body.user.role, 'user');
    assert.equal('passwordHash' in r.body.user, false);
    const raw = await User.findOne({ email: 'ann@test.io' }).select('+passwordHash');
    assert.match(raw.passwordHash, /^\$2[aby]\$/); // bcrypt, not plaintext

    const l = await api().post('/api/auth/login').send({ email: 'ann@test.io', password: PW });
    assert.equal(l.status, 200);
    assert.ok(l.body.token);
  });
  it('rejects weak password, duplicate email, bad login, and self-assigned role', async () => {
    assert.equal((await api().post('/api/auth/register').send({ name: 'x', email: 'w@t.io', password: 'short' })).status, 400);
    assert.equal((await api().post('/api/auth/register').send({ name: 'Ann2', email: 'ann@test.io', password: PW })).status, 409);
    const wrong = await api().post('/api/auth/login').send({ email: 'ann@test.io', password: 'nope-nope-nope' });
    const ghost = await api().post('/api/auth/login').send({ email: 'ghost@test.io', password: PW });
    assert.equal(wrong.status, 401);
    assert.equal(ghost.status, 401);
    assert.deepEqual(wrong.body, ghost.body); // no user enumeration
    const esc = await api().post('/api/auth/register').send({ name: 'Evil', email: 'evil@t.io', password: PW, role: 'admin' });
    assert.equal(esc.status, 400);
    assert.equal(await User.countDocuments({ email: 'evil@t.io' }), 0);
  });
  it('blocks NoSQL operator injection on login', async () => {
    const res = await api().post('/api/auth/login').send({ email: { $gt: '' }, password: { $gt: '' } });
    assert.equal(res.status, 400);
  });
  it('rejects missing, garbage, alg:none and wrong-secret tokens', async () => {
    const { id } = await register('Tok', 'tok@test.io');
    assert.equal((await api().get('/api/auth/me')).status, 401);
    assert.equal((await api().get('/api/auth/me').set(auth('garbage'))).status, 401);
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: id })}.`;
    assert.equal((await api().get('/api/auth/me').set(auth(none))).status, 401);
    const forged = jwt.sign({ sub: id }, 'a-different-secret-a-different-secret!!');
    assert.equal((await api().get('/api/auth/me').set(auth(forged))).status, 401);
  });
  it('a deleted user’s token stops working immediately', async () => {
    const admin = await makeAdmin('admin-del@test.io');
    const victim = await register('Vic', 'vic@test.io');
    assert.equal((await api().get('/api/auth/me').set(auth(victim.token))).status, 200);
    assert.equal((await api().delete(`/api/users/${victim.id}`).set(auth(admin.token))).status, 204);
    assert.equal((await api().get('/api/auth/me').set(auth(victim.token))).status, 401);
  });
});

describe('notes: user CRUD, isolation, pagination', () => {
  let a, b;
  before(async () => {
    a = await register('A', 'a@notes.io');
    b = await register('B', 'b@notes.io');
  });

  it('creates, reads, updates and deletes own notes', async () => {
    const c = await api().post('/api/notes').set(auth(a.token)).send({ title: 'T1', content: 'hello' });
    assert.equal(c.status, 201);
    const id = c.body.note.id;
    assert.equal((await api().get(`/api/notes/${id}`).set(auth(a.token))).body.note.content, 'hello');
    const u = await api().put(`/api/notes/${id}`).set(auth(a.token)).send({ content: 'changed' });
    assert.equal(u.body.note.content, 'changed');
    assert.equal(u.body.note.title, 'T1');
    assert.equal((await api().delete(`/api/notes/${id}`).set(auth(a.token))).status, 204);
    assert.equal((await api().get(`/api/notes/${id}`).set(auth(a.token))).status, 404);
  });
  it('another user cannot read, update, or delete my note (404, not 403)', async () => {
    const { body } = await api().post('/api/notes').set(auth(a.token)).send({ title: 'private' });
    const id = body.note.id;
    assert.equal((await api().get(`/api/notes/${id}`).set(auth(b.token))).status, 404);
    assert.equal((await api().put(`/api/notes/${id}`).set(auth(b.token)).send({ title: 'hax' })).status, 404);
    assert.equal((await api().delete(`/api/notes/${id}`).set(auth(b.token))).status, 404);
    assert.equal((await Note.findById(id)).title, 'private');
  });
  it('lists only my own notes, newest first, paginated', async () => {
    for (let i = 1; i <= 5; i++) await api().post('/api/notes').set(auth(b.token)).send({ title: `B${i}` });
    const p1 = await api().get('/api/notes?limit=2&page=1').set(auth(b.token));
    assert.equal(p1.body.data.length, 2);
    assert.equal(p1.body.data[0].title, 'B5');
    assert.deepEqual(p1.body.pagination, { page: 1, limit: 2, total: 5, totalPages: 3 });
    const p3 = await api().get('/api/notes?limit=2&page=3').set(auth(b.token));
    assert.deepEqual(p3.body.data.map((n) => n.title), ['B1']);
    assert.ok(p1.body.data.every((n) => n.owner === b.id));
  });
  it('validates input and pagination bounds', async () => {
    assert.equal((await api().post('/api/notes').set(auth(a.token)).send({ title: '' })).status, 400);
    assert.equal((await api().post('/api/notes').set(auth(a.token)).send({ title: 'x', owner: b.id })).status, 400);
    assert.equal((await api().get('/api/notes?limit=1000').set(auth(a.token))).status, 400);
    assert.equal((await api().get('/api/notes/not-an-id').set(auth(a.token))).status, 400);
    assert.equal((await api().get(`/api/notes?owner=${b.id}`).set(auth(a.token))).status, 403);
  });
});

describe('RBAC: admin', () => {
  let admin, u1, u2;
  before(async () => {
    admin = await makeAdmin('boss@test.io');
    u1 = await register('U1', 'u1@rbac.io');
    u2 = await register('U2', 'u2@rbac.io');
    await api().post('/api/notes').set(auth(u1.token)).send({ title: 'u1-note' });
    await api().post('/api/notes').set(auth(u2.token)).send({ title: 'u2-note' });
  });

  it('plain users cannot touch any admin endpoint', async () => {
    for (const [m, p] of [['get', '/api/users'], ['get', '/api/users/interests'], ['post', '/api/users'],
      ['put', `/api/users/${u2.id}`], ['delete', `/api/users/${u2.id}`]]) {
      assert.equal((await api()[m](p).set(auth(u1.token)).send({ name: 'x' })).status, 403, `${m} ${p}`);
    }
    assert.equal((await api().get(`/api/users/${u2.id}`).set(auth(u1.token))).status, 403);
    assert.equal((await api().get(`/api/users/${u1.id}`).set(auth(u1.token))).status, 200); // own profile ok
  });
  it('admin sees everyone’s notes, and can filter by owner', async () => {
    const all = await api().get('/api/notes?limit=100').set(auth(admin.token));
    const owners = new Set(all.body.data.map((n) => n.owner));
    assert.ok(owners.has(u1.id) && owners.has(u2.id));
    const only = await api().get(`/api/notes?owner=${u2.id}`).set(auth(admin.token));
    assert.deepEqual(only.body.data.map((n) => n.title), ['u2-note']);
  });
  it('admin can view but NOT modify or delete another user’s note', async () => {
    const note = (await api().get(`/api/notes?owner=${u1.id}`).set(auth(admin.token))).body.data[0];
    assert.equal((await api().get(`/api/notes/${note.id}`).set(auth(admin.token))).status, 200);
    assert.equal((await api().put(`/api/notes/${note.id}`).set(auth(admin.token)).send({ title: 'x' })).status, 404);
    assert.equal((await api().delete(`/api/notes/${note.id}`).set(auth(admin.token))).status, 404);
    // …but inherits User powers over their OWN notes
    const mine = await api().post('/api/notes').set(auth(admin.token)).send({ title: 'admin-own' });
    assert.equal((await api().put(`/api/notes/${mine.body.note.id}`).set(auth(admin.token)).send({ title: 'ok' })).status, 200);
  });
  it('admin: add, list (paginated), update, remove users', async () => {
    const c = await api().post('/api/users').set(auth(admin.token))
      .send({ name: 'New', email: 'new@rbac.io', password: PW, role: 'user', interests: ['Go'] });
    assert.equal(c.status, 201);
    assert.deepEqual(c.body.user.interests, ['go']);
    const list = await api().get('/api/users?limit=2').set(auth(admin.token));
    assert.equal(list.body.data.length, 2);
    assert.ok(list.body.pagination.total >= 4);
    assert.ok(list.body.data.every((u) => !('passwordHash' in u)));
    const up = await api().put(`/api/users/${c.body.user.id}`).set(auth(admin.token)).send({ role: 'admin', name: 'Renamed' });
    assert.equal(up.body.user.role, 'admin');
    assert.equal((await api().put(`/api/users/${c.body.user.id}`).set(auth(admin.token)).send({ email: 'u1@rbac.io' })).status, 409);
    assert.equal((await api().delete(`/api/users/${c.body.user.id}`).set(auth(admin.token))).status, 204);
    assert.equal((await api().get(`/api/users/${c.body.user.id}`).set(auth(admin.token))).status, 404);
  });
  it('admin cannot delete or demote themselves', async () => {
    assert.equal((await api().delete(`/api/users/${admin.id}`).set(auth(admin.token))).status, 400);
    assert.equal((await api().put(`/api/users/${admin.id}`).set(auth(admin.token)).send({ role: 'user' })).status, 400);
  });
  it('deleting a user cascades to their notes and posts', async () => {
    const v = await register('Cascade', 'cascade@rbac.io');
    await api().post('/api/notes').set(auth(v.token)).send({ title: 'n' });
    await api().post('/api/posts').set(auth(v.token)).send({ title: 'p' });
    await api().delete(`/api/users/${v.id}`).set(auth(admin.token));
    assert.equal(await Note.countDocuments({ owner: v.id }), 0);
    assert.equal(await Post.countDocuments({ author: v.id }), 0);
  });
});

describe('Scenario 1: group users by interests (single aggregate)', () => {
  let admin;
  before(async () => {
    await User.deleteMany({});
    admin = await makeAdmin('agg-admin@test.io');
    await register('Alice', 'alice@agg.io', ['chess', 'reading']);
    await register('Bob', 'bob@agg.io', ['Chess']);
    await register('Cara', 'cara@agg.io', [' READING ', 'hiking', 'reading']);
    await register('Dan', 'dan@agg.io', []);
  });

  it('groups, counts, normalises case and de-duplicates', async () => {
    const r = await api().get('/api/users/interests').set(auth(admin.token));
    assert.equal(r.status, 200);
    const byName = Object.fromEntries(r.body.data.map((g) => [g.interest, g]));
    assert.deepEqual(r.body.data.map((g) => g.interest), ['chess', 'hiking', 'reading']); // sorted
    assert.equal(byName.chess.count, 2);
    assert.equal(byName.reading.count, 2); // Cara counted once despite duplicate entries
    assert.deepEqual(byName.chess.users.map((u) => u.name).sort(), ['Alice', 'Bob']);
    assert.equal(r.body.pagination.total, 3);
    assert.ok(r.body.data.every((g) => g.users.every((u) => Object.keys(u).sort().join() === 'id,name')));
  });
  it('filters by one interest', async () => {
    const r = await api().get('/api/users/interests?interest=Reading').set(auth(admin.token));
    assert.deepEqual(r.body.data.map((g) => [g.interest, g.count]), [['reading', 2]]);
  });
  it('paginates groups', async () => {
    const p2 = await api().get('/api/users/interests?limit=1&page=2').set(auth(admin.token));
    assert.deepEqual(p2.body.data.map((g) => g.interest), ['hiking']);
    assert.deepEqual(p2.body.pagination, { page: 2, limit: 1, total: 3, totalPages: 3 });
  });
  it('returns an empty page, not an error, for an unknown interest', async () => {
    const r = await api().get('/api/users/interests?interest=nope').set(auth(admin.token));
    assert.deepEqual(r.body.data, []);
    assert.equal(r.body.pagination.total, 0);
  });
});

describe('Scenario 2: posts of a user via $lookup', () => {
  let author, other;
  before(async () => {
    author = await register('Writer', 'writer@posts.io');
    other = await register('Other', 'other@posts.io');
    for (let i = 1; i <= 5; i++) await api().post('/api/posts').set(auth(author.token)).send({ title: `P${i}`, body: 'x' });
    await api().post('/api/posts').set(auth(other.token)).send({ title: 'not-mine' });
  });

  it('is public and returns only that user’s posts, newest first', async () => {
    const r = await api().get(`/api/users/${author.id}/posts`); // no token
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.posts.map((p) => p.title), ['P5', 'P4', 'P3', 'P2', 'P1']);
    assert.equal(r.body.user.name, 'Writer');
    assert.equal(JSON.stringify(r.body).includes('writer@posts.io'), false); // no email leak
  });
  it('paginates with hasMore', async () => {
    const p1 = await api().get(`/api/users/${author.id}/posts?limit=2&page=1`);
    assert.deepEqual(p1.body.posts.map((p) => p.title), ['P5', 'P4']);
    assert.equal(p1.body.pagination.hasMore, true);
    const p3 = await api().get(`/api/users/${author.id}/posts?limit=2&page=3`);
    assert.deepEqual(p3.body.posts.map((p) => p.title), ['P1']);
    assert.equal(p3.body.pagination.hasMore, false);
  });
  it('404 for unknown user, 400 for malformed id, empty list for user without posts', async () => {
    assert.equal((await api().get(`/api/users/${new mongoose.Types.ObjectId()}/posts`)).status, 404);
    assert.equal((await api().get('/api/users/zzz/posts')).status, 400);
    const none = await register('Quiet', 'quiet@posts.io');
    assert.deepEqual((await api().get(`/api/users/${none.id}/posts`)).body.posts, []);
  });
  it('creating a post requires authentication', async () => {
    assert.equal((await api().post('/api/posts').send({ title: 'x' })).status, 401);
  });
});

describe('API documentation', () => {
  it('serves Swagger UI and its assets with a docs-only CSP', async () => {
    const ui = await api().get('/api-docs/');
    assert.equal(ui.status, 200);
    assert.match(ui.type, /html/);
    assert.match(ui.headers['content-security-policy'], /style-src 'self' 'unsafe-inline'/);

    const css = await api().get('/api-docs/swagger-ui.css');
    assert.equal(css.status, 200);
    assert.match(css.type, /css/);
  });

  it('serves the OpenAPI spec with protected and public operations documented', async () => {
    const response = await api().get('/api-docs/openapi.json');
    assert.equal(response.status, 200);
    assert.equal(response.body.openapi, '3.0.3');
    assert.ok(response.body.paths['/api/notes/{id}'].delete);
    assert.deepEqual(response.body.paths['/api/auth/me'].get.security, [{ bearerAuth: [] }]);
    assert.equal(response.body.paths['/api/users/{id}/posts'].get.security, undefined);
  });
});

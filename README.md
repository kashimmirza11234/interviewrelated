# Secure Notes — REST API + minimal UI

Node.js · Express 5 · MongoDB/Mongoose 9 · JWT · bcrypt. The frontend is a single static page with no
framework (`public/`); it exists only to exercise the API.

## Run it

```bash
git clone https://github.com/kashimmirza11234/interviewrelated.git
cd interviewrelated
npm ci
cp .env.example .env
npm start
```

`cp` works on Linux and macOS. On Windows PowerShell, use
`Copy-Item .env.example .env`. Edit `.env` and set a JWT secret of at least 32 characters.

The app needs MongoDB at `127.0.0.1:27017` by default. Either install MongoDB locally or start the
included MongoDB container:

```bash
docker compose up -d mongo
npm run seed:admin
npm start
```

When the server is running:

- App: http://localhost:3000
- Swagger UI: http://localhost:3000/api-docs
- OpenAPI JSON: http://localhost:3000/api-docs/openapi.json

Useful commands:

```bash
npm run dev                     # restart on source changes
npm test                        # integration tests; requires MongoDB
npm run explain                 # seeds a scratch DB and prints query plans
npm run seed:admin              # create the first admin account
```

`npm ci` requires Node.js 18 or newer and uses the committed `package-lock.json`. MongoDB 5.0 or newer
is required.

Swagger UI documents all API endpoints and supports **Try it out**. Register or log in, then click
**Authorize** and enter the returned JWT to try protected endpoints.

Requires **MongoDB ≥ 5.0** (the Scenario 2 `$lookup` uses `localField`/`foreignField` + `pipeline`) and Node ≥ 18.

## API

| Method & path | Who | Notes |
|---|---|---|
| `POST /api/auth/register` | public | always creates role `user`; `role` in the body is rejected (400) |
| `POST /api/auth/login` | public | generic error for unknown email / wrong password |
| `GET /api/auth/me`, `PUT /api/auth/me` | any user | self-edit: `name`, `interests` only |
| `POST /api/notes` | user, admin | |
| `GET /api/notes?page&limit` | user → own notes; admin → **all** notes (`&owner=` to narrow) | paginated |
| `GET /api/notes/:id` | owner or admin | others get 404 (no id probing) |
| `PUT` / `DELETE /api/notes/:id` | **owner only** | admins included, see decisions |
| `POST /api/users` · `GET /api/users` · `PUT` / `DELETE /api/users/:id` | admin | list is paginated; delete cascades to notes + posts |
| `GET /api/users/:id` | admin, or the user themself | |
| `GET /api/users/interests?page&limit&interest=` | admin | **Scenario 1** |
| `POST /api/posts` | any user | |
| `GET /api/users/:id/posts?page&limit` | **public** | **Scenario 2** |

Every list endpoint takes `page` (default 1) and `limit` (default 20, max 100) and returns `pagination`.

## Indexing strategy

Exactly **four** explicit indexes, all declared with `schema.index()` in the model files, plus MongoDB's automatic `_id`.

| Index | Serves |
|---|---|
| `users { email: 1 }` unique | login `findOne({email})`; uniqueness on register / admin create / admin update |
| `users { interests: 1 }` multikey | Scenario 1 when filtered (`?interest=`) — the `$match` before `$unwind` |
| `notes { owner: 1, _id: -1 }` | "my notes" newest-first (equality + sort in one index, no in-memory sort); admin "notes of user X"; cascade delete |
| `posts { author: 1, _id: -1 }` | Scenario 2 `$lookup` join + sort; cascade delete |

**Deliberately not created** (each would be pure write overhead):
- **Admin list of users** and **admin list of all notes** sort by `_id` descending. An ObjectId starts with a
  timestamp, so `_id` order *is* creation order, and the built-in `_id` index serves it. No `createdAt` index.
- `GET /users/:id`, `/auth/me`, the per-request JWT user lookup, `GET/PUT/DELETE /notes/:id` → `_id`.
- `owner` alone, `role`, `name`: nothing filters or sorts on them (and `{owner,_id}` already has `owner` as prefix).

A test (`indexes › creates exactly the justified indexes and nothing else`) fails if anyone adds one.

### Measured with `explain('executionStats')`

5,000 users, 100,000 notes, 100,000 posts, one page = `skip 10, limit 5` (MongoDB 8.3.7):

```
QUERY                                        RESULT                      INDEX(ES)                  keys/docs examined
--------------------------------------------------------------------------------------------------------------------------------
login: findOne({email})                       index                       email_1                    1/1
GET /users/:id, /auth/me, JWT lookup          index                       _id_                       1/1
admin list users (sort _id desc, paged)       index                       _id_                       15/5
user list own notes (owner + sort _id desc)   index                       owner_1__id_-1             15/5
  …its page total: countDocuments({owner})    index                       owner_1__id_-1             20/20
admin list ALL notes (sort _id desc, paged)   index                       _id_                       15/5
GET /notes/:id                                index                       _id_                       0/0
update/delete note ({_id, owner})             index                       _id_                       0/0
cascade delete notes ({owner})                index                       owner_1__id_-1             20/20
cascade delete posts ({author})               index                       author_1__id_-1            20/20
SCENARIO 1: group by interests (no filter)    COLLECTION SCAN             -                          0/5000
SCENARIO 1: group by interests ?interest=     index                       interests_1                1161/1161
SCENARIO 2: user posts via $lookup            index                       _id_, author_1__id_-1      17/7

Indexes that exist:
  users  _id_, email_1, interests_1
  notes  _id_, owner_1__id_-1
  posts  _id_, author_1__id_-1
```

How to read it: for the paged list queries a page costs `skip + limit` index keys and only `limit` documents, with no collection scan and no in-memory sort. `GET /notes/:id` and the `{_id, owner}` row show `0/0` only because the probe id doesn't exist; a hit is `1/1`. The two Scenario 1 rows read every (matching) user by nature, because grouping needs all of them — see the caveat below.

**Honest caveat on Scenario 1.** *Unfiltered*, "group every user by interest" must read every user's `interests`;
no index can cover an `$unwind` over an array (multikey indexes can't cover array fields), so it is a collection
scan by nature. The `interests_1` index is justified by the optional `?interest=` filter. If you consider that
filter out of scope, drop both the `$match` stages and the index — it's a 3-line change in `src/queries.js` and `User.js`.

## Aggregations (`src/queries.js`)

**Scenario 1 — group by interests.** One `User.aggregate()` call, nothing else touches the collection:
`[$match?] → $unwind → [$match?] → $group (count + users) → $sort → $facet{ groups: skip/limit/project, meta: $count }`.
`$facet` returns the page **and** the total group count in the same call, so pagination needs no second query.
Interests are normalised (trim, lowercase, de-duplicate) on write so `Chess`/`chess` group together.

**Scenario 2 — a user's posts.** One `User.aggregate()` with a single `$lookup`:
`$match {_id} → $lookup {from: posts, localField: _id, foreignField: author, pipeline: [$sort, $skip, $limit+1, $project]} → $project`.
`limit+1` rows are fetched to compute `hasMore` without a count. I compared this against the older
`let` + `$expr` form: same index, but the `localField` form skips on index keys *before* fetching documents
(6 docs read instead of 16 for the same page), so I used it.

## Security

- Passwords: bcrypt (cost 12; `BCRYPT_ROUNDS`), hash stored with `select: false` and never serialised. Max 72 *bytes* (bcrypt's real limit) is enforced rather than silently truncated.
- JWT HS256, algorithm pinned on verify (rejects `alg:none`), 1 h expiry, secret required at boot (≥ 32 chars).
- The user (and therefore **role**) is re-read from the DB on every request: deleting a user or demoting an admin takes effect immediately, not at token expiry.
- All input validated with strict zod schemas: unknown keys are rejected (no mass-assignment of `role`/`owner`), and operator objects like `{"$gt": ""}` can't reach a query (tested).
- Login: one generic error + a dummy bcrypt compare for unknown emails (limits enumeration, including by timing). Rate limit on `/api/auth`.
- Notes of other users return 404, not 403. Public posts route projects only `id`/`name` of the author (tested: no email leak).
- `helmet` headers; the UI writes with `textContent` only (a stored `<img onerror>` note renders as text — tested in a real browser).

## Decisions worth knowing about

1. **Admin can *view* all notes but only edit/delete their own.** The spec says admins inherit User rights and can *view* everyone's notes; it does not grant modifying others'. Changing this is one filter in `routes/notes.js`.
2. **Scenario 1 view is admin-only** (it lists other users' names). One line (`requireRole`) to open it up.
3. **Offset pagination** (`skip/limit`). Simple and what was asked for, but skipping costs O(skip) index keys (visible in the table above). For very deep paging, switch to keyset pagination on `_id`.
4. **Totals:** filtered lists use `countDocuments`; unfiltered lists use `estimatedDocumentCount` (O(1), can be slightly off after an unclean shutdown).
5. **Cascade delete is not transactional** (a standalone MongoDB has no transactions). The user is removed first so they can't log in; a crash leaves only harmless orphan rows.
6. Each group in Scenario 1 returns at most 50 users (`MAX_USERS_PER_GROUP`) while `count` stays exact — keeps the response far below the 16 MB document limit. Users with no interests don't appear in any group.

## Known limitations / not done

- Tested against MongoDB 8.3.7 and Node 22 only. Not tested on Atlas or MongoDB 5.x/6.x/7.x.
- No refresh tokens or server-side revocation list (mitigated by the per-request DB check above). The UI keeps the token in `sessionStorage`; an httpOnly cookie would be stronger against XSS but needs CSRF handling.
- The rate limiter is in-memory (per process); use a shared store behind multiple instances, and set `trust proxy` behind a reverse proxy.
- `autoIndex` builds the indexes on startup — fine here; for a large production database build indexes via a migration.
- No email verification or password reset.

## Layout

```
src/models/{User,Note,Post}.js   schemas + schema.index() with a comment per index
src/queries.js                   the two aggregation pipelines (shared by routes and explain script)
src/routes/*.js                  auth, users (admin + both scenarios), notes, posts
src/middleware/*.js              authenticate / requireRole, validate (zod), error handler
scripts/seedAdmin.js, explain.js
test/api.test.js                 27 integration tests against a real MongoDB
public/                          minimal UI
```

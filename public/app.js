// Plain JS, no framework. Every value from the server is inserted with textContent (never innerHTML),
// so stored note/post content cannot inject markup or script.
const $ = (s) => document.querySelector(s);
const state = { token: sessionStorage.getItem('token'), user: null, page: { notes: 1, users: 1, groups: 1, posts: 1 } };

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) k === 'onclick' ? el.addEventListener('click', v) : el.setAttribute(k, v);
  for (const k of kids) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}
function say(text, ok = false) { const m = $('#msg'); m.textContent = text; m.className = ok ? 'ok' : 'err'; setTimeout(() => (m.className = ''), 5000); }

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && state.token) logout();
    const d = data.details ? ': ' + data.details.map((x) => (x.path ? x.path + ' ' : '') + (x.message || x)).join('; ') : '';
    throw new Error((data.error || res.statusText) + d);
  }
  return data;
}
const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { say(e.message); } };
const pager = (name, p, hasNext) => {
  $('#' + name + 'Page').textContent = p.totalPages != null ? `page ${p.page} of ${Math.max(p.totalPages, 1)} (${p.total} total)` : `page ${p.page}`;
  $('#' + name + 'Prev').disabled = p.page <= 1; $('#' + name + 'Next').disabled = !hasNext;
};

function setSession(data) { state.token = data.token; state.user = data.user; sessionStorage.setItem('token', data.token); showApp(); }
function logout() { state.token = null; state.user = null; sessionStorage.removeItem('token'); $('#app').classList.add('hidden'); $('#auth').classList.remove('hidden'); }

async function showApp() {
  if (!state.user) state.user = (await api('/auth/me')).user;
  const admin = state.user.role === 'admin';
  $('#auth').classList.add('hidden'); $('#app').classList.remove('hidden');
  $('#admin').classList.toggle('hidden', !admin);
  $('#me').textContent = `${state.user.name} (${state.user.role}) — id ${state.user.id}`;
  $('#notesTitle').textContent = admin ? 'All notes (admin view; edit/delete only your own)' : 'My notes';
  $('#postsUserId').value = state.user.id;
  await loadNotes(); if (admin) { await loadUsers(); await loadGroups(); }
}

/* ── auth ── */
$('#loginForm').addEventListener('submit', guard(async (e) => {
  e.preventDefault(); const f = new FormData(e.target);
  setSession(await api('/auth/login', { method: 'POST', body: { email: f.get('email'), password: f.get('password') } }));
}));
$('#registerBtn').addEventListener('click', guard(async () => {
  const f = new FormData($('#loginForm'));
  const interests = String(f.get('interests') || '').split(',').map((s) => s.trim()).filter(Boolean);
  setSession(await api('/auth/register', { method: 'POST', body: { name: f.get('name'), email: f.get('email'), password: f.get('password'), interests } }));
}));
$('#logout').addEventListener('click', logout);

/* ── notes ── */
async function loadNotes() {
  const { data, pagination: p } = await api(`/notes?page=${state.page.notes}&limit=5`);
  const box = $('#notes'); box.replaceChildren();
  if (!data.length) box.append(h('div', { class: 'muted' }, 'No notes.'));
  for (const n of data) {
    const mine = n.owner === state.user.id;
    box.append(h('div', { class: 'item' },
      h('b', {}, n.title), h('div', {}, n.content), h('div', { class: 'muted' }, `owner ${n.owner} · ${n.updatedAt}`),
      ...(mine ? [
        h('button', { onclick: guard(async () => {
          const title = prompt('Title', n.title); if (title === null) return;
          const content = prompt('Content', n.content); if (content === null) return;
          await api('/notes/' + n.id, { method: 'PUT', body: { title, content } }); await loadNotes();
        }) }, 'Edit'),
        h('button', { onclick: guard(async () => { if (confirm('Delete?')) { await api('/notes/' + n.id, { method: 'DELETE' }); await loadNotes(); } }) }, 'Delete'),
      ] : [])));
  }
  pager('notes', p, p.page < p.totalPages);
}
$('#noteForm').addEventListener('submit', guard(async (e) => {
  e.preventDefault(); const f = new FormData(e.target);
  await api('/notes', { method: 'POST', body: { title: f.get('title'), content: f.get('content') } });
  e.target.reset(); state.page.notes = 1; await loadNotes();
}));
$('#notesPrev').addEventListener('click', guard(() => { state.page.notes--; return loadNotes(); }));
$('#notesNext').addEventListener('click', guard(() => { state.page.notes++; return loadNotes(); }));

/* ── posts (public read; $lookup endpoint) ── */
async function loadPosts() {
  const id = $('#postsUserId').value.trim(); if (!id) return;
  const { user, posts, pagination: p } = await api(`/users/${id}/posts?page=${state.page.posts}&limit=5`);
  const box = $('#posts'); box.replaceChildren(h('div', { class: 'muted' }, `Posts by ${user.name}`));
  for (const x of posts) box.append(h('div', { class: 'item' }, h('b', {}, x.title), h('div', {}, x.body)));
  if (!posts.length) box.append(h('div', { class: 'muted' }, 'No posts.'));
  pager('posts', p, p.hasMore);
}
$('#postForm').addEventListener('submit', guard(async (e) => {
  e.preventDefault(); const f = new FormData(e.target);
  await api('/posts', { method: 'POST', body: { title: f.get('title'), body: f.get('body') } });
  e.target.reset(); say('Post published', true); $('#postsUserId').value = state.user.id; state.page.posts = 1; await loadPosts();
}));
$('#loadPosts').addEventListener('click', guard(() => { state.page.posts = 1; return loadPosts(); }));
$('#postsPrev').addEventListener('click', guard(() => { state.page.posts--; return loadPosts(); }));
$('#postsNext').addEventListener('click', guard(() => { state.page.posts++; return loadPosts(); }));

/* ── admin: users ── */
async function loadUsers() {
  const { data, pagination: p } = await api(`/users?page=${state.page.users}&limit=5`);
  const body = $('#users'); body.replaceChildren();
  for (const u of data) {
    const self = u.id === state.user.id;
    body.append(h('tr', {}, h('td', {}, u.name), h('td', {}, u.email), h('td', {}, u.role), h('td', {}, u.interests.join(', ')), h('td', { class: 'muted' }, u.id),
      h('td', {}, ...(self ? [] : [
        h('button', { onclick: guard(async () => { await api('/users/' + u.id, { method: 'PUT', body: { role: u.role === 'admin' ? 'user' : 'admin' } }); await loadUsers(); }) }, u.role === 'admin' ? 'Make user' : 'Make admin'),
        h('button', { onclick: guard(async () => { if (confirm('Delete user and all their data?')) { await api('/users/' + u.id, { method: 'DELETE' }); await loadUsers(); await loadNotes(); } }) }, 'Delete'),
      ]))));
  }
  pager('users', p, p.page < p.totalPages);
}
$('#userForm').addEventListener('submit', guard(async (e) => {
  e.preventDefault(); const f = new FormData(e.target);
  await api('/users', { method: 'POST', body: Object.fromEntries(f) }); e.target.reset(); await loadUsers(); say('User created', true);
}));
$('#usersPrev').addEventListener('click', guard(() => { state.page.users--; return loadUsers(); }));
$('#usersNext').addEventListener('click', guard(() => { state.page.users++; return loadUsers(); }));

/* ── admin: group by interests (aggregation) ── */
async function loadGroups() {
  const interest = $('#interestFilter').value.trim();
  const q = `page=${state.page.groups}&limit=5` + (interest ? '&interest=' + encodeURIComponent(interest) : '');
  const { data, pagination: p } = await api('/users/interests?' + q);
  const box = $('#groups'); box.replaceChildren();
  if (!data.length) box.append(h('div', { class: 'muted' }, 'No groups.'));
  for (const g of data) box.append(h('div', { class: 'item' }, h('b', {}, `${g.interest} (${g.count})`), h('div', { class: 'muted' }, g.users.map((u) => u.name).join(', '))));
  pager('groups', p, p.page < p.totalPages);
}
$('#loadGroups').addEventListener('click', guard(() => { state.page.groups = 1; return loadGroups(); }));
$('#groupsPrev').addEventListener('click', guard(() => { state.page.groups--; return loadGroups(); }));
$('#groupsNext').addEventListener('click', guard(() => { state.page.groups++; return loadGroups(); }));

if (state.token) showApp().catch(logout);

// Creates the first admin (public registration can only ever create role "user").
// Usage: ADMIN_EMAIL=you@x.com ADMIN_PASSWORD='long-password' npm run seed:admin
const mongoose = require('mongoose');
const config = require('../src/config');
const User = require('../src/models/User');
const { hashPassword } = require('../src/utils/password');

(async () => {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!email || password.length < 8) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD (min 8 chars)');

  await mongoose.connect(config.mongoUri);
  await User.init();
  const existing = await User.findOne({ email });
  if (existing) {
    console.log(`User ${email} already exists (role: ${existing.role}). Nothing changed.`);
  } else {
    await User.create({ name: 'Admin', email, role: 'admin', passwordHash: await hashPassword(password) });
    console.log(`Admin ${email} created.`);
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });

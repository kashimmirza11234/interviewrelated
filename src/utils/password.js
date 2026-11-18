const bcrypt = require('bcryptjs');
const { bcryptRounds } = require('../config');

const hashPassword = (plain) => bcrypt.hash(plain, bcryptRounds);
const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

// Compared against when the email does not exist, so "unknown email" and
// "wrong password" take about the same time (limits user enumeration by timing).
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', bcryptRounds);

module.exports = { hashPassword, verifyPassword, DUMMY_HASH };

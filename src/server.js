const mongoose = require('mongoose');
const config = require('./config');
const app = require('./app');
const models = [require('./models/User'), require('./models/Note'), require('./models/Post')];

async function main() {
  await mongoose.connect(config.mongoUri);
  // init() waits for the schema.index() definitions to be built before we accept traffic.
  await Promise.all(models.map((m) => m.init()));

  const server = app.listen(config.port, '127.0.0.1', () => console.log(`API + UI on http://localhost:${config.port}`));

  const shutdown = () => server.close(() => mongoose.disconnect().then(() => process.exit(0)));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Startup failed:', err.message);
  process.exit(1);
});

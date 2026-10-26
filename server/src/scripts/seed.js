/**
 * Seeds demo accounts and a short conversation history.
 *
 *   cd server && npm run seed
 *
 * Demo password for every account: Connectly123 (override with SEED_PASSWORD).
 * Only ever run this against a development database.
 */
import config from '../config/env.js';
import { initStore, closeStore, getStore } from '../store/index.js';
import { seedDemoData } from '../utils/demoData.js';
import logger from '../utils/logger.js';

async function main() {
  if (config.isProd) {
    logger.error('Refusing to seed a production database. Unset NODE_ENV=production first.');
    process.exit(1);
  }
  await initStore();
  const store = getStore();
  await seedDemoData(store, { password: process.env.SEED_PASSWORD || 'Connectly123' });
  logger.info('Seed complete', { driver: store.driver });
  await closeStore();
}

main().catch(async (error) => {
  logger.error('Seed failed', { error: error.message });
  await closeStore();
  process.exit(1);
});

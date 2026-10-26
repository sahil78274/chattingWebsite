import config from '../config/env.js';
import MemoryStore from './memory/MemoryStore.js';
import { MongoStore } from './mongo/MongoStore.js';
import logger from '../utils/logger.js';

let store = null;

/**
 * Returns the process-wide store instance. `DB_DRIVER=mongo` uses MongoDB
 * Atlas through Mongoose; `memory` is an ephemeral in-process store for local
 * demos and automated tests. Both implement the same API contract.
 */
export function getStore() {
  if (!store) store = config.db.driver === 'mongo' ? new MongoStore() : new MemoryStore();
  return store;
}

export async function initStore() {
  const instance = getStore();
  if (instance.driver === 'mongo') {
    if (!config.db.mongoUri) {
      throw new Error('DB_DRIVER=mongo but MONGODB_URI is empty. Set MONGODB_URI in your .env file.');
    }
    await instance.connect(config.db.mongoUri);
    logger.info('Store ready', { driver: 'mongo' });
  } else {
    logger.warn(
      'Using the in-memory store: data will be lost on restart. Set MONGODB_URI (and DB_DRIVER=mongo) for persistence.',
      { driver: 'memory' }
    );
  }
  return instance;
}

export async function closeStore() {
  if (store?.driver === 'mongo') await store.disconnect();
}

export default getStore;

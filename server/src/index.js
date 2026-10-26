import http from 'node:http';
import config from './config/env.js';
import logger from './utils/logger.js';
import { createApp } from './app.js';
import { initStore, closeStore, getStore } from './store/index.js';
import { createSocketServer } from './sockets/index.js';

async function main() {
  const store = await initStore();

  if (config.db.seedDemo && !config.isProd) {
    const { seedDemoData } = await import('./utils/demoData.js');
    await seedDemoData(store);
  }

  const app = createApp();
  const server = http.createServer(app);
  const io = createSocketServer(server, store);
  app.set('io', io);

  server.listen(config.port, '0.0.0.0', () => {
    logger.info('Connectly API listening', {
      port: config.port,
      env: config.nodeEnv,
      driver: store.driver,
      corsOrigins: config.cors.origins
    });
  });

  const shutdown = async (signal) => {
    logger.info('Shutting down', { signal });
    io.close();
    server.close(async () => {
      await closeStore();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { error: String(reason) });
  });
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error: error.message });
  });

  return { app, server, io, store };
}

main().catch((error) => {
  logger.error('Fatal startup error', { error: error.message });
  process.exit(1);
});

export { getStore };

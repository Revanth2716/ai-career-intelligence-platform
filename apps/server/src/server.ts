import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma, disconnectPrisma } from './lib/prisma.js';
import { queue } from './jobs/queue.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'server_started');
});

/**
 * Graceful shutdown: stop accepting connections, drain the queue, close DB.
 */
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info({ signal }, 'shutting_down');
    server.close(() => undefined);
    void (async () => {
      await queue.stop();
      await disconnectPrisma();
      process.exit(0);
    })();
  });
}

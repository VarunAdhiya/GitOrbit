import pino from 'pino';
import { createDatabase } from '@gitorbit/database';
import { readEnv } from '../../../packages/shared/src/env.ts';
import { createQueue, redisConnection, waitForRedis } from '../../../packages/shared/src/queue.ts';
import { createApp } from './app.ts';
const env = readEnv();
const logger = pino({ base: { service: 'api' } });
const db = createDatabase(env.DATABASE_URL);
const redis = redisConnection(env.REDIS_URL);
const queue = createQueue(env.REDIS_URL);
redis.on('error', () => logger.error({ code: 'REDIS_CONNECTION' }, 'Redis connection unavailable'));
queue.on('error', () => logger.error({ code: 'QUEUE_CONNECTION' }, 'Queue connection unavailable'));
try {
  await waitForRedis(redis);
} catch {
  logger.fatal(
    { code: 'REDIS_STARTUP' },
    'Start Redis and check REDIS_URL before starting the API.',
  );
  redis.disconnect();
  await queue.close();
  await db.$disconnect();
  process.exit(1);
}
const app = createApp({ env, logger, db, redis, queue });
const server = app.listen(env.PORT, () =>
  logger.info({ port: env.PORT }, 'GitOrbit API listening'),
);
server.requestTimeout = 75000;
server.headersTimeout = 10000;
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  server.close(() => {
    void (async () => {
      await queue.close();
      await redis.quit();
      await db.$disconnect();
    })();
  });
  setTimeout(() => {
    server.closeAllConnections();
    process.exit(1);
  }, 15000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

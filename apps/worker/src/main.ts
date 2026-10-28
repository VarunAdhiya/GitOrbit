import { Worker } from 'bullmq';
import pino from 'pino';
import { createDatabase } from '@gitorbit/database';
import { type JobPayload } from '@gitorbit/shared';
import { readEnv } from '../../../packages/shared/src/env.ts';
import { createQueue, redisConnection, QUEUE_NAME } from '../../../packages/shared/src/queue.ts';
import { GitHubProvider, RateLimitError } from './providers/github.ts';
import { processIngestion } from './processor.ts';
import { initializeSchedules } from './schedules.ts';
const env = readEnv();
if (!env.GITHUB_TOKEN) throw new Error('Set GITHUB_TOKEN before starting ingestion workers.');
const logger = pino({ base: { service: 'worker' } });
const db = createDatabase(env.DATABASE_URL);
const redis = redisConnection(env.REDIS_URL, true);
redis.on('error', () =>
  logger.error({ code: 'REDIS_CONNECTION' }, 'Worker Redis connection failed'),
);
const queue = createQueue(env.REDIS_URL);
queue.on('error', () => logger.error({ code: 'QUEUE_CONNECTION' }, 'Queue connection failed'));
const provider = new GitHubProvider(env.GITHUB_TOKEN, fetch, async () => {
  // Shared reservation across workers: at most ~28 GitHub requests/minute, including search.
  const wait = Number(
    await redis.eval(
      "local n=tonumber(ARGV[1]); local slot=math.max(n,tonumber(redis.call('get',KEYS[1]) or '0')); redis.call('psetex',KEYS[1],60000,slot+2100); return slot-n",
      1,
      'gitorbit:github:request-slot',
      Date.now(),
    ),
  );
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
});
const worker = new Worker<JobPayload>(
  QUEUE_NAME,
  async (job) => {
    try {
      return await processIngestion(job, {
        db,
        redis,
        queue,
        provider,
        languages: env.GITHUB_LANGUAGES.split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        staleHours: env.STALE_HOURS,
      });
    } catch (e) {
      if (e instanceof RateLimitError) {
        await worker.rateLimit(e.delay);
        throw Worker.RateLimitError();
      }
      throw e;
    }
  },
  {
    connection: { url: env.REDIS_URL, maxRetriesPerRequest: null },
    concurrency: env.WORKER_CONCURRENCY,
    limiter: { max: 3, duration: 1000 },
    maxStalledCount: 2,
  },
);
worker.on('completed', (job) => logger.info({ jobId: job.id, jobType: job.name }, 'Job completed'));
worker.on('failed', (job, error) =>
  logger.error(
    { jobId: job?.id, jobType: job?.name, attempt: job?.attemptsMade, errorType: error.name },
    'Job failed; BullMQ retains retry diagnostics',
  ),
);
worker.on('error', (error) => logger.error({ errorType: error.name }, 'Worker error'));
await initializeSchedules(queue);
logger.info('Ingestion worker and recurring schedules ready');
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await worker.close();
  await queue.close();
  await redis.quit();
  await db.$disconnect();
}
process.on('SIGTERM', () => {
  void close();
});
process.on('SIGINT', () => {
  void close();
});

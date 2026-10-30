import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import type { JobPayload } from './index.ts';
export const QUEUE_NAME = 'gitorbit-ingestion';
export const jobOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { age: 86400, count: 1000 },
  removeOnFail: { age: 604800, count: 2000 },
};
export function redisConnection(url: string, worker = false) {
  return new Redis(url, {
    maxRetriesPerRequest: worker ? null : 1,
    connectTimeout: 5000,
    enableOfflineQueue: worker,
    retryStrategy: (times) => Math.min(times * 500, 10000),
  });
}
// API connections fail fast instead of buffering requests during an outage. Wait for
// the initial handshake before RedisStore starts loading its Lua scripts.
export function waitForRedis(redis: Redis, timeoutMs = 10000): Promise<void> {
  if (redis.status === 'ready') return Promise.resolve();
  if (redis.status === 'end') return Promise.reject(new Error('Redis connection is closed.'));
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      redis.off('ready', ready);
      redis.off('error', failed);
      redis.off('end', failed);
    };
    const ready = () => {
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      reject(new Error('Redis is unavailable. Start Redis and check REDIS_URL.'));
    };
    const timer = setTimeout(failed, timeoutMs);
    redis.once('ready', ready);
    redis.once('error', failed);
    redis.once('end', failed);
    if (redis.status === 'wait') void redis.connect().catch(failed);
  });
}
export function createQueue(url: string, name = QUEUE_NAME) {
  return new Queue<JobPayload>(name, {
    connection: { url, maxRetriesPerRequest: 1, enableOfflineQueue: false },
    defaultJobOptions: jobOptions,
  });
}

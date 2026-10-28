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
export function createQueue(url: string, name = QUEUE_NAME) {
  return new Queue<JobPayload>(name, {
    connection: { url, maxRetriesPerRequest: 1, enableOfflineQueue: false },
    defaultJobOptions: jobOptions,
  });
}

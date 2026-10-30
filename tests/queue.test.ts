import { EventEmitter } from 'node:events';
import type { Redis } from 'ioredis';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForRedis } from '../packages/shared/src/queue.ts';

function connection(status = 'connecting') {
  return Object.assign(new EventEmitter(), { status }) as Redis;
}

afterEach(() => vi.useRealTimers());

describe('API Redis startup', () => {
  it('waits for readiness before allowing commands with the offline queue disabled', async () => {
    const redis = connection();
    let started = false;
    const startup = waitForRedis(redis).then(() => {
      started = true;
    });
    await Promise.resolve();
    expect(started).toBe(false);
    redis.emit('ready');
    await startup;
    expect(started).toBe(true);
    expect(redis.eventNames()).toEqual([]);
  });

  it('accepts an already ready connection', async () => {
    await expect(waitForRedis(connection('ready'))).resolves.toBeUndefined();
  });

  it.each(['error', 'end'])('fails safely on %s and removes startup listeners', async (event) => {
    const redis = connection();
    const startup = waitForRedis(redis);
    redis.emit(event, new Error('secret connection details'));
    await expect(startup).rejects.toThrow('Redis is unavailable. Start Redis and check REDIS_URL.');
    expect(redis.eventNames()).toEqual([]);
  });

  it('bounds the startup wait when Redis never becomes ready', async () => {
    vi.useFakeTimers();
    const redis = connection();
    const startup = expect(waitForRedis(redis, 100)).rejects.toThrow('Redis is unavailable');
    await vi.advanceTimersByTimeAsync(100);
    await startup;
    expect(redis.eventNames()).toEqual([]);
  });
});

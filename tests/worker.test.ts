import { describe, expect, it, vi } from 'vitest';
import {
  processIngestion,
  deduplicationKey,
  type ProcessorDependencies,
} from '../apps/worker/src/processor.ts';
import { initializeSchedules } from '../apps/worker/src/schedules.ts';
import { jobOptions } from '../packages/shared/src/queue.ts';
import { RateLimitError, SourceError } from '../apps/worker/src/providers/github.ts';
import type { Job } from 'bullmq';
import type { JobPayload } from '@gitorbit/shared';
function deps() {
  return {
    db: {
      ingestionRun: {
        create: vi.fn().mockResolvedValue({ id: 'run' }),
        update: vi.fn().mockResolvedValue({}),
      },
      issue: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { id: 'i1', issueNumber: 1, repository: { owner: 'test', name: 'repo' } },
          ]),
        update: vi.fn().mockResolvedValue({}),
      },
    },
    queue: { add: vi.fn() },
    redis: { set: vi.fn().mockResolvedValue('OK'), eval: vi.fn().mockResolvedValue(1) },
    provider: { source: 'github', issue: vi.fn().mockResolvedValue({ state: 'closed' }) },
    languages: ['TypeScript'],
    staleHours: 48,
  };
}
const job = {
  id: 'j1',
  data: { type: 'refresh-issue-status', mode: 'incremental' },
} as Job<JobPayload>;
describe('worker execution and retries', () => {
  it('keeps exponential retries bounded and retains dead jobs', () => {
    expect(jobOptions.attempts).toBe(5);
    expect(jobOptions.backoff).toEqual({ type: 'exponential', delay: 5000 });
    expect(jobOptions.removeOnFail.count).toBe(2000);
  });
  it('uses deterministic deduplication keys', () => {
    expect(deduplicationKey(job.data)).toBe(deduplicationKey({ ...job.data }));
    expect(deduplicationKey(job.data)).not.toBe(
      deduplicationKey({ ...job.data, mode: 'backfill' }),
    );
  });
  it('synchronizes closed issues rather than leaving them discoverable', async () => {
    const d = deps();
    await processIngestion(job, d as unknown as ProcessorDependencies);
    expect(d.db.issue.update).toHaveBeenCalledWith({
      where: { id: 'i1' },
      data: { state: 'closed' },
    });
    expect(d.db.ingestionRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'completed' }) }),
    );
  });
  it('marks disappeared issues unavailable', async () => {
    const d = deps();
    d.provider.issue.mockRejectedValue(new SourceError(404));
    await processIngestion(job, d as unknown as ProcessorDependencies);
    expect(d.db.issue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: 'unavailable', stale: true }),
      }),
    );
  });
  it('propagates transient errors to BullMQ and releases leases', async () => {
    const d = deps();
    d.provider.issue.mockRejectedValue(new Error('network'));
    await expect(processIngestion(job, d as unknown as ProcessorDependencies)).rejects.toThrow(
      'network',
    );
    expect(d.db.ingestionRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }),
    );
    expect(d.redis.eval).toHaveBeenCalled();
  });
  it('records rate-limited runs separately', async () => {
    const d = deps();
    d.provider.issue.mockRejectedValue(new RateLimitError(60000));
    await expect(
      processIngestion(job, d as unknown as ProcessorDependencies),
    ).rejects.toBeInstanceOf(RateLimitError);
    expect(d.db.ingestionRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'rate_limited' }) }),
    );
  });
  it('prevents overlapping bulk runs', async () => {
    const d = deps();
    d.redis.set.mockResolvedValue(null);
    expect(await processIngestion(job, d as unknown as ProcessorDependencies)).toEqual({
      skipped: 'overlapping-run',
    });
    expect(d.db.ingestionRun.create).not.toHaveBeenCalled();
  });
  it('initializes five modern job schedulers idempotently', async () => {
    const queue = { upsertJobScheduler: vi.fn() };
    await initializeSchedules(queue as never);
    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(5);
    expect(queue.upsertJobScheduler.mock.calls[0][0]).toBe('schedule-discover-repositories');
  });
});

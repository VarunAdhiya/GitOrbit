import type { Queue } from 'bullmq';
import { type JobPayload, jobTypes } from '@gitorbit/shared';
import { jobOptions } from '../../../packages/shared/src/queue.ts';
export async function initializeSchedules(queue: Queue<JobPayload>) {
  const intervals = [6 * 3600000, 30 * 60000, 3600000, 10 * 60000, 3600000];
  for (const [index, type] of jobTypes.entries()) {
    await queue.upsertJobScheduler(
      `schedule-${type}`,
      { every: intervals[index] },
      { name: type, data: { type, mode: 'incremental' }, opts: jobOptions },
    );
  }
}

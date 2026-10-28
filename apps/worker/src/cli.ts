import { readEnv } from '../../../packages/shared/src/env.ts';
import { createQueue } from '../../../packages/shared/src/queue.ts';
import { jobPayloadSchema } from '@gitorbit/shared';
import { initializeSchedules } from './schedules.ts';
import { enqueue } from './processor.ts';
const env = readEnv();
const queue = createQueue(env.REDIS_URL);
queue.on('error', () => console.error('Redis connection unavailable.'));
try {
  const command = process.argv[2];
  if (command === 'schedule') {
    await initializeSchedules(queue);
    console.log('Five recurring job schedulers initialized.');
  } else if (command === 'trigger') {
    const data = jobPayloadSchema.parse({
      type: process.argv[3] || 'discover-issues',
      mode: process.argv.includes('--backfill') ? 'backfill' : 'incremental',
    });
    const job = await enqueue(queue, data);
    console.log(JSON.stringify({ jobId: job.id, ...data }));
  } else if (command === 'health') {
    console.log(
      JSON.stringify(
        {
          counts: await queue.getJobCounts(),
          schedulers: await queue.getJobSchedulers(),
          failed: (await queue.getFailed(0, 19)).map((j) => ({
            id: j.id,
            name: j.name,
            attempts: j.attemptsMade,
            reason: j.failedReason,
          })),
        },
        null,
        2,
      ),
    );
  } else throw new Error('Use schedule, trigger [job-type] [--backfill], or health.');
} finally {
  await queue.close();
}

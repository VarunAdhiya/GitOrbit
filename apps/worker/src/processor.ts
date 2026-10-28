import { createHash, randomUUID } from 'node:crypto';
import type { Job, Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { PrismaClient } from '@gitorbit/database';
import { jobPayloadSchema, type JobPayload } from '@gitorbit/shared';
import { SourceError, RateLimitError } from './providers/github.ts';
import type { OpportunityProvider } from './providers/provider.ts';
export type ProcessorDependencies = {
  db: PrismaClient;
  queue: Queue<JobPayload>;
  redis: Redis;
  provider: OpportunityProvider;
  languages: string[];
  staleHours: number;
};
export function deduplicationKey(data: JobPayload) {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}
export async function enqueue(queue: Queue<JobPayload>, data: JobPayload) {
  return queue.add(data.type, data, { deduplication: { id: deduplicationKey(data) } });
}
export async function processIngestion(job: Job<JobPayload>, deps: ProcessorDependencies) {
  const data = jobPayloadSchema.parse(job.data);
  const { db, queue, redis, provider } = deps;
  const lockKey = `gitorbit:lock:${data.type}:${data.language || ''}:${data.label || ''}:${data.cursor || ''}`;
  const lockToken = randomUUID();
  if (!(await redis.set(lockKey, lockToken, 'PX', 120000, 'NX')))
    return { skipped: 'overlapping-run' };
  let leaseLost = false;
  const renew = setInterval(() => {
    void redis
      .eval(
        "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('pexpire',KEYS[1],120000) else return 0 end",
        1,
        lockKey,
        lockToken,
      )
      .then((result) => {
        if (result !== 1) leaseLost = true;
      })
      .catch(() => {
        leaseLost = true;
      });
  }, 30000);
  const assertLease = () => {
    if (leaseLost) throw new Error('Ingestion lease lost; retry required.');
  };
  let run: { id: string } | undefined;
  let processed = 0;
  try {
    run = await db.ingestionRun.create({
      data: { jobId: job.id || 'manual', jobType: data.type, status: 'running' },
    });
    if (
      (data.type === 'discover-issues' || data.type === 'discover-repositories') &&
      !data.language
    ) {
      for (const language of deps.languages) {
        if (data.type === 'discover-issues') {
          for (const label of ['good first issue', 'help wanted'] as const)
            await enqueue(queue, { ...data, language, label });
        } else await enqueue(queue, { ...data, language });
      }
    } else if (data.type === 'discover-repositories') {
      for await (const normalized of provider.searchRepositories(data.language!)) {
        assertLease();
        const {
          languages: _languages,
          contributionUrl: _url,
          lastSyncedAt: _synced,
          ...metadata
        } = normalized;
        await db.repository.upsert({
          where: {
            source_externalId: { source: provider.source, externalId: normalized.externalId },
          },
          create: { ...normalized, lastSyncedAt: new Date(0) },
          update: metadata,
        });
        processed++;
      }
    } else if (data.type === 'discover-issues') {
      const key = `${provider.source}:${data.language}:${data.label}`;
      const previous = await db.syncCursor.findUnique({ where: { key } });
      const until = new Date();
      const from =
        data.mode === 'backfill'
          ? new Date(until.getTime() - 90 * 86400000)
          : new Date((previous?.timestamp.getTime() || until.getTime() - 7 * 86400000) - 300000);
      for await (const candidate of provider.searchIssues(
        data.language!,
        data.label || 'good first issue',
        from,
        until,
      )) {
        assertLease();
        const normalized = candidate.issue;
        const { owner, name } = candidate.repository;
        let repo = await db.repository.findUnique({
          where: { source_owner_name: { source: provider.source, owner, name } },
        });
        if (!repo || repo.lastSyncedAt.getTime() < Date.now() - 86400000) {
          const metadata = await provider.repository(owner, name);
          repo = await db.repository.upsert({
            where: {
              source_externalId: { source: provider.source, externalId: metadata.externalId },
            },
            create: metadata,
            update: metadata,
          });
        }
        // Search indexes can lag a direct status refresh. An older search result must
        // never reopen a closed issue or overwrite more recent source metadata.
        await db.$transaction([
          db.issue.createMany({
            data: [{ ...normalized, repositoryId: repo.id }],
            skipDuplicates: true,
          }),
          db.issue.updateMany({
            where: {
              source: provider.source,
              externalId: normalized.externalId,
              OR: [
                { updatedAtSource: { lt: normalized.updatedAtSource } },
                { updatedAtSource: normalized.updatedAtSource, state: normalized.state },
              ],
            },
            data: { ...normalized, repositoryId: repo.id },
          }),
        ]);
        processed++;
        if (processed % 25 === 0) await job.updateProgress(processed);
      }
      assertLease();
      await db.syncCursor.upsert({
        where: { key },
        create: { key, timestamp: until },
        update: { timestamp: until },
      });
    } else if (data.type === 'refresh-issue-status') {
      const cutoff = data.cutoff || new Date(Date.now() - 15 * 60000).toISOString();
      const rows = await db.issue.findMany({
        where: {
          source: provider.source,
          state: 'open',
          lastSyncedAt: { lt: new Date(cutoff) },
          ...(data.cursor ? { id: { gt: data.cursor } } : {}),
        },
        include: { repository: true },
        orderBy: { id: 'asc' },
        take: 50,
      });
      for (const issue of rows) {
        assertLease();
        try {
          const normalized = await provider.issue(
            issue.repository.owner,
            issue.repository.name,
            issue.issueNumber,
          );
          await db.issue.update({
            where: { id: issue.id },
            data: normalized || { stale: true, lastSyncedAt: new Date() },
          });
        } catch (e) {
          if (e instanceof SourceError && [404, 410].includes(e.status))
            await db.issue.update({
              where: { id: issue.id },
              data: { state: 'unavailable', stale: true, lastSyncedAt: new Date() },
            });
          else throw e;
        }
        processed++;
      }
      if (rows.length === 50) await enqueue(queue, { ...data, cutoff, cursor: rows.at(-1)!.id });
    } else if (data.type === 'sync-repository-metadata') {
      const cutoff = data.cutoff || new Date(Date.now() - 6 * 3600000).toISOString();
      const rows = await db.repository.findMany({
        where: {
          source: provider.source,
          lastSyncedAt: { lt: new Date(cutoff) },
          ...(data.cursor ? { id: { gt: data.cursor } } : {}),
        },
        orderBy: { id: 'asc' },
        take: 25,
      });
      for (const repo of rows) {
        assertLease();
        try {
          await db.repository.update({
            where: { id: repo.id },
            data: await provider.repository(repo.owner, repo.name),
          });
        } catch (e) {
          if (e instanceof SourceError && [404, 410].includes(e.status))
            await db.repository.update({
              where: { id: repo.id },
              data: { archived: true, lastSyncedAt: new Date() },
            });
          else throw e;
        }
        processed++;
      }
      if (rows.length === 25) await enqueue(queue, { ...data, cutoff, cursor: rows.at(-1)!.id });
    } else if (data.type === 'cleanup-stale-opportunities') {
      const result = await db.issue.updateMany({
        where: {
          stale: false,
          lastSyncedAt: { lt: new Date(Date.now() - deps.staleHours * 3600000) },
        },
        data: { stale: true },
      });
      processed = result.count;
      await db.userProfile.deleteMany({ where: { expiresAt: { lt: new Date() } } });
      await db.ingestionRun.updateMany({
        where: { status: 'running', startedAt: { lt: new Date(Date.now() - 6 * 3600000) } },
        data: {
          status: 'interrupted',
          finishedAt: new Date(),
          errorSummary: 'Run did not finish before monitoring timeout.',
        },
      });
      await db.ingestionRun.deleteMany({
        where: { startedAt: { lt: new Date(Date.now() - 30 * 86400000) } },
      });
    }
    await db.ingestionRun.update({
      where: { id: run.id },
      data: { status: 'completed', processedCount: processed, finishedAt: new Date() },
    });
    return { processed };
  } catch (e) {
    if (run)
      await db.ingestionRun
        .update({
          where: { id: run.id },
          data: {
            status: e instanceof RateLimitError ? 'rate_limited' : 'failed',
            processedCount: processed,
            failedCount: 1,
            finishedAt: new Date(),
            errorSummary:
              e instanceof SourceError
                ? e.message
                : e instanceof RateLimitError
                  ? 'GitHub rate limit; delayed retry.'
                  : 'Ingestion failed; inspect worker diagnostics.',
          },
        })
        .catch(() => {});
    throw e;
  } finally {
    clearInterval(renew);
    await redis
      .eval(
        "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
        1,
        lockKey,
        lockToken,
      )
      .catch(() => {});
  }
}

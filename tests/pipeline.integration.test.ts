import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Worker, QueueEvents } from 'bullmq';
import request from 'supertest';
import pino from 'pino';
import { createDatabase, type PrismaClient } from '@gitorbit/database';
import type { JobPayload } from '@gitorbit/shared';
import { createQueue, redisConnection } from '../packages/shared/src/queue.ts';
import { readEnv } from '../packages/shared/src/env.ts';
import { GitHubProvider } from '../apps/worker/src/providers/github.ts';
import { processIngestion } from '../apps/worker/src/processor.ts';
import { createApp } from '../apps/api/src/app.ts';
import { rawIssue, rawRepository, profile } from './fixtures.ts';

// Explicit URLs are required. No implicit connection to a developer's production database.
const databaseUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
describe.skipIf(!databaseUrl || !redisUrl)(
  'real BullMQ + PostgreSQL pipeline with mock GitHub and LLM',
  () => {
    let db: PrismaClient;
    let queue: ReturnType<typeof createQueue>;
    let redis: ReturnType<typeof redisConnection>;
    let events: QueueEvents;
    let worker: Worker<JobPayload>;
    let app: ReturnType<typeof createApp>;
    let closed = false;
    let failNext = true;
    const unique = randomUUID();
    const externalId = Math.floor(Math.random() * 1e12);
    const owner = `test-${unique}`;
    const repo = {
      ...rawRepository,
      id: externalId,
      owner: { login: owner },
      html_url: `https://github.com/${owner}/accessible-ui`,
    };
    const issue = { ...rawIssue, id: externalId + 1, html_url: `${repo.html_url}/issues/12` };
    const createdProfiles: string[] = [];
    beforeAll(async () => {
      if (!new URL(databaseUrl!).pathname.toLowerCase().includes('test'))
        throw new Error('TEST_DATABASE_URL must name an isolated test database.');
      db = createDatabase(databaseUrl!);
      redis = redisConnection(redisUrl!, true);
      const name = `gitorbit-test-${unique}`;
      queue = createQueue(redisUrl!, name);
      events = new QueueEvents(name, { connection: { url: redisUrl! } });
      await events.waitUntilReady();
      const fetcher: typeof fetch = async (input) => {
        const url = new URL(String(input));
        if (url.pathname === '/search/issues') {
          if (failNext) {
            failNext = false;
            return new Response('', { status: 503 });
          }
          return Response.json({
            total_count: 2,
            incomplete_results: false,
            items: [issue, issue],
          });
        }
        if (url.pathname.endsWith('/languages')) return Response.json({ TypeScript: 1000 });
        if (url.pathname.endsWith('/community/profile'))
          return Response.json({
            files: { contributing: { html_url: `${repo.html_url}/blob/main/CONTRIBUTING.md` } },
          });
        if (url.pathname.endsWith('/issues/12'))
          return Response.json({ ...issue, state: closed ? 'closed' : 'open' });
        return Response.json(repo);
      };
      const provider = new GitHubProvider('mock-token', fetcher);
      worker = new Worker<JobPayload>(
        name,
        (job) =>
          processIngestion(job, {
            db,
            redis,
            queue,
            provider,
            languages: ['TypeScript'],
            staleHours: 48,
          }),
        { connection: { url: redisUrl!, maxRetriesPerRequest: null }, concurrency: 1 },
      );
      await worker.waitUntilReady();
      const rls = await db.$queryRaw<
        { tablename: string; rowsecurity: boolean }[]
      >`SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('repositories', 'issues', 'skills', 'user_profiles', 'profile_skills', 'programs', 'issue_programs', 'ingestion_runs', 'sync_cursors')`;
      expect(rls).toHaveLength(9);
      expect(rls.every((table) => table.rowsecurity)).toBe(true);
      const env = readEnv({
        NODE_ENV: 'test',
        DATABASE_URL: databaseUrl!,
        REDIS_URL: redisUrl!,
        LLM_API_KEY: 'mock-key',
      });
      app = createApp({
        db,
        redis,
        queue,
        env,
        logger: pino({ level: 'silent' }),
        extract: async () => 'Built React and TypeScript developer tools',
        analyze: async () => ({
          skills: profile.skills,
          experienceLevel: 'beginner',
          experienceSummary: ['Built React and TypeScript developer tools'],
        }),
      });
    }, 30000);
    afterAll(async () => {
      await worker?.close();
      await events?.close();
      if (queue) {
        await queue.obliterate({ force: true });
        await queue.close();
      }
      if (db) {
        await db.userProfile.deleteMany({ where: { id: { in: createdProfiles } } });
        await db.repository.deleteMany({ where: { externalId: String(externalId) } });
        await db.$disconnect();
      }
      await redis?.quit();
    });
    it('retries a transient GitHub failure, deduplicates, serves issues, protects profiles and ranks matches', async () => {
      const job = await queue.add(
        'discover-issues',
        {
          type: 'discover-issues',
          language: 'TypeScript',
          label: 'good first issue',
          mode: 'backfill',
        },
        { attempts: 3, backoff: { type: 'exponential', delay: 50 } },
      );
      await job.waitUntilFinished(events, 15000);
      expect((await queue.getJob(job.id!))?.attemptsMade).toBe(2);
      expect(await db.issue.count({ where: { externalId: String(externalId + 1) } })).toBe(1);
      const all = await request(app).get(`/api/v1/opportunities?repository=${owner}`);
      expect(all.status).toBe(200);
      expect(all.body.total).toBe(1);
      expect(all.body.items[0].repository.name).toBe('accessible-ui');
      const alice = request.agent(app);
      const bob = request.agent(app);
      const analysis = await alice
        .post('/api/v1/resumes/analyze')
        .set('X-GitOrbit', '1')
        .set('X-Resume-Consent', 'true')
        .attach('resume', Buffer.from('%PDF-1.7 mocked body'), {
          filename: 'resume.pdf',
          contentType: 'application/pdf',
        });
      expect(analysis.status).toBe(201);
      createdProfiles.push(analysis.body.id);
      expect(analysis.headers['set-cookie'][0]).toContain('HttpOnly');
      expect(analysis.body).not.toHaveProperty('anonymousSessionId');
      expect((await bob.get(`/api/v1/profiles/${analysis.body.id}`)).status).toBe(401);
      expect(
        (
          await bob
            .patch(`/api/v1/profiles/${analysis.body.id}`)
            .set('X-GitOrbit', '1')
            .send(profile)
        ).status,
      ).toBe(401);
      const edited = await alice
        .patch(`/api/v1/profiles/${analysis.body.id}`)
        .set('X-GitOrbit', '1')
        .send(profile);
      expect(edited.status).toBe(200);
      const recommendations = await alice.get(`/api/v1/recommendations?repository=${owner}`);
      expect(recommendations.status).toBe(200);
      expect(recommendations.body.items[0].match.score).toBe(100);
      expect(recommendations.body.items[0].match.matchingSkills).toContain('React');
      const replay = await queue.add('discover-issues', {
        type: 'discover-issues',
        language: 'TypeScript',
        label: 'good first issue',
        mode: 'backfill',
      });
      await replay.waitUntilFinished(events, 15000);
      expect(await db.issue.count({ where: { externalId: String(externalId + 1) } })).toBe(1);
      closed = true;
      await db.issue.updateMany({
        where: { externalId: String(externalId + 1) },
        data: { lastSyncedAt: new Date(0) },
      });
      const refresh = await queue.add('refresh-issue-status', {
        type: 'refresh-issue-status',
        mode: 'incremental',
      });
      await refresh.waitUntilFinished(events, 15000);
      expect((await request(app).get(`/api/v1/opportunities?repository=${owner}`)).body.total).toBe(
        0,
      );
      expect(
        (
          await db.issue.findUnique({
            where: { source_externalId: { source: 'github', externalId: String(externalId + 1) } },
          })
        )?.state,
      ).toBe('closed');
      const staleSearch = await queue.add('discover-issues', {
        type: 'discover-issues',
        language: 'TypeScript',
        label: 'good first issue',
        mode: 'backfill',
      });
      await staleSearch.waitUntilFinished(events, 15000);
      expect((await request(app).get(`/api/v1/opportunities?repository=${owner}`)).body.total).toBe(
        0,
      );
      expect(
        (await alice.delete(`/api/v1/profiles/${analysis.body.id}`).set('X-GitOrbit', '1')).status,
      ).toBe(204);
      expect((await alice.get(`/api/v1/profiles/${analysis.body.id}`)).status).toBe(401);
      expect(await db.profileSkill.count({ where: { profileId: analysis.body.id } })).toBe(0);
      const expired = await bob.post('/api/v1/profiles').set('X-GitOrbit', '1').send(profile);
      expect(expired.status).toBe(201);
      createdProfiles.push(expired.body.id);
      await db.userProfile.update({
        where: { id: expired.body.id },
        data: { expiresAt: new Date(0) },
      });
      expect((await bob.get('/api/v1/recommendations')).status).toBe(404);
      const cleanup = await queue.add('cleanup-stale-opportunities', {
        type: 'cleanup-stale-opportunities',
        mode: 'incremental',
      });
      await cleanup.waitUntilFinished(events, 15000);
      expect(await db.userProfile.findUnique({ where: { id: expired.body.id } })).toBeNull();
    }, 60000);
  },
);

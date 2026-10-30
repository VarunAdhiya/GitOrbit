import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Worker, QueueEvents } from 'bullmq';
import request from 'supertest';
import pino from 'pino';
import { createDatabase, type PrismaClient } from '@gitorbit/database';
import type { JobPayload } from '@gitorbit/shared';
import { createQueue, redisConnection, waitForRedis } from '../packages/shared/src/queue.ts';
import { readEnv } from '../packages/shared/src/env.ts';
import { GitHubProvider } from '../apps/worker/src/providers/github.ts';
import { processIngestion } from '../apps/worker/src/processor.ts';
import { createApp } from '../apps/api/src/app.ts';
import { saveProfile, claimGuestProfile, getProfile } from '../apps/api/src/profiles.ts';
import { listOpportunities } from '../apps/api/src/opportunities.ts';
import { filtersSchema } from '@gitorbit/shared';
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
    const aliceId = randomUUID();
    const bobId = randomUUID();
    beforeAll(async () => {
      if (!new URL(databaseUrl!).pathname.toLowerCase().includes('test'))
        throw new Error('TEST_DATABASE_URL must name an isolated test database.');
      db = createDatabase(databaseUrl!);
      redis = redisConnection(redisUrl!);
      await waitForRedis(redis);
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
        auth: (req) => ({
          getUser: async () => {
            const token = req.get('Authorization');
            const id =
              token === 'Bearer test-alice' ? aliceId : token === 'Bearer test-bob' ? bobId : null;
            return id ? { id, name: 'Test contributor', email: null } : null;
          },
          start: async () => '',
          exchange: async () => {
            throw new Error('unused');
          },
          signOut: async () => {},
        }),
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
      const alice = request.agent(app).set('Authorization', 'Bearer test-alice');
      const bob = request.agent(app).set('Authorization', 'Bearer test-bob');
      const analysis = await alice
        .post('/api/v1/resumes/analyze')
        .set('X-GitOrbit', '1')
        .attach('resume', Buffer.from('%PDF-1.7 mocked body'), {
          filename: 'resume.pdf',
          contentType: 'application/pdf',
        });
      expect(analysis.status).toBe(201);
      createdProfiles.push(analysis.body.id);
      expect(analysis.body.expiresAt).toBeNull();
      expect(
        (await db.userProfile.findUniqueOrThrow({ where: { id: analysis.body.id } })).authUserId,
      ).toBe(aliceId);
      expect(analysis.body).not.toHaveProperty('anonymousSessionId');
      expect((await bob.get(`/api/v1/profiles/${analysis.body.id}`)).status).toBe(404);
      expect(
        (
          await bob
            .patch(`/api/v1/profiles/${analysis.body.id}`)
            .set('X-GitOrbit', '1')
            .send(profile)
        ).status,
      ).toBe(404);
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
      expect((await alice.get(`/api/v1/profiles/${analysis.body.id}`)).status).toBe(404);
      expect(await db.profileSkill.count({ where: { profileId: analysis.body.id } })).toBe(0);
      // Legacy anonymous profiles can still expire and be cleaned up, but cannot access the API.
      const expired = await saveProfile(db, profile, { ttlHours: 24 });
      createdProfiles.push(expired.profile.id);
      await db.userProfile.update({
        where: { id: expired.profile.id },
        data: { expiresAt: new Date(0) },
      });
      expect((await bob.get('/api/v1/recommendations')).status).toBe(404);
      await expect(getProfile(db, expired.token!)).rejects.toMatchObject({ status: 404 });
      const cleanup = await queue.add('cleanup-stale-opportunities', {
        type: 'cleanup-stale-opportunities',
        mode: 'incremental',
      });
      await cleanup.waitUntilFinished(events, 15000);
      expect(await db.userProfile.findUnique({ where: { id: expired.profile.id } })).toBeNull();
    }, 60000);
    it('filters primary languages and sorts all results by repository popularity before pagination', async () => {
      const prefix = `filters-${unique}`;
      const ids: string[] = [];
      const specs = [
        { name: 'stars', language: 'Python', stars: 900, forks: 5, assigned: false },
        { name: 'shared', language: 'Python', stars: 100, forks: 90, assigned: false },
        { name: 'assigned', language: 'Python', stars: 200, forks: 15, assigned: true },
        { name: 'shared', language: 'TypeScript', stars: 1000, forks: 100, assigned: false },
      ];
      try {
        for (const [i, spec] of specs.entries()) {
          const repository = await db.repository.create({
            data: {
              externalId: `${prefix}-${i}`,
              owner: `${prefix}-${i}`,
              name: spec.name,
              sourceUrl: `https://github.com/${prefix}-${i}/${spec.name}`,
              primaryLanguage: spec.language,
              languages: ['Python', 'TypeScript', 'Rust'],
              stars: spec.stars,
              forks: spec.forks,
              createdAtSource: new Date(),
              lastPushedAt: new Date(),
              issues: {
                create: {
                  externalId: `${prefix}-${i}`,
                  issueNumber: 1,
                  title: `Filtering fixture ${i}`,
                  sourceUrl: `https://github.com/${prefix}-${i}/${spec.name}/issues/1`,
                  createdAtSource: new Date(),
                  updatedAtSource: new Date(Date.now() + i * 1000),
                  difficulty: 'beginner',
                  assigned: spec.assigned,
                  relevantSkills: ['React'],
                },
              },
            },
          });
          ids.push(repository.id);
        }
        for (const sort of ['stars', 'forks'] as const) {
          const expected =
            sort === 'stars' ? ['stars', 'assigned', 'shared'] : ['shared', 'assigned', 'stars'];
          for (let page = 1; page <= 3; page++) {
            const filters = filtersSchema.parse({
              repository: prefix,
              language: 'python',
              sort,
              limit: 1,
              page,
            });
            const result = await listOpportunities(db, filters, 48, profile);
            expect(result.total).toBe(3);
            expect(result.pages).toBe(3);
            expect(result.items[0].repository.primaryLanguage).toBe('Python');
            expect(result.items[0].repository.name).toBe(expected[page - 1]);
            expect(result.items[0]).toHaveProperty('match');
          }
        }
        const combined = await request(app).get(
          `/api/v1/opportunities?repository=${prefix}&language=Python&sort=stars&available=true&difficulty=beginner&activity=month`,
        );
        expect(combined.status).toBe(200);
        expect(combined.body.total).toBe(2);
        expect(
          combined.body.items.map((item: { repository: { name: string } }) => item.repository.name),
        ).toEqual(['stars', 'shared']);
        const exact = await request(app).get(`/api/v1/opportunities?repository=${prefix}-1/shared`);
        expect(exact.body.total).toBe(1);
        expect(exact.body.items[0].repository.id).toBe(ids[1]);
        const matched = await listOpportunities(
          db,
          filtersSchema.parse({ repository: prefix, language: 'Python', sort: 'match' }),
          48,
          profile,
        );
        expect(matched.total).toBe(3);
        expect(matched.items.every((item) => item.repository.primaryLanguage === 'Python')).toBe(
          true,
        );
        const facets = await request(app).get('/api/v1/opportunities/facets');
        expect(facets.status).toBe(200);
        expect(facets.body.languages).toContain('Python');
        expect(facets.body.languages).not.toContain('Rust');
      } finally {
        await db.repository.deleteMany({ where: { id: { in: ids } } });
      }
    });
    it('saves and replaces 80 skills, retaining shared vocabulary and extracted confidence', async () => {
      const authUserId = randomUUID();
      const skills = Array.from({ length: 80 }, (_, i) => ({
        name: `batch-${i}`,
        category: 'tools' as const,
        confidence: 0.75,
        source: 'extracted' as const,
      }));
      const saved = await saveProfile(db, { ...profile, skills }, { authUserId, ttlHours: 24 });
      createdProfiles.push(saved.profile.id);
      expect(saved.profile.skills).toHaveLength(80);
      expect(
        saved.profile.skills.every((s) => s.confidence === 0.75 && s.source === 'extracted'),
      ).toBe(true);
      const first = await db.skill.findUniqueOrThrow({ where: { normalizedName: 'batch-0' } });
      const updated = await saveProfile(
        db,
        {
          ...profile,
          skills: [
            { ...skills[0], source: 'user' },
            { ...skills[1], name: 'batch-new' },
          ],
        },
        { authUserId, ttlHours: 24, id: saved.profile.id },
      );
      expect(updated.profile.id).toBe(saved.profile.id);
      expect(updated.profile.skills).toHaveLength(2);
      expect(updated.profile.skills.find((s) => s.name === 'batch-0')?.confidence).toBe(1);
      expect(
        await db.profileSkill.findUnique({
          where: {
            profileId_skillId: { profileId: saved.profile.id, skillId: first.id },
          },
        }),
      ).not.toBeNull();
      expect(await db.profileSkill.count({ where: { profileId: saved.profile.id } })).toBe(2);
      await saveProfile(db, { ...profile, skills: [] }, { authUserId, ttlHours: 24 });
      expect((await getProfile(db, undefined, undefined, authUserId)).skills).toHaveLength(0);
    }, 15000);
    it('saves account profiles across sessions and prevents cross-account or old guest access', async () => {
      const account = randomUUID();
      const otherAccount = randomUUID();
      const guest = await saveProfile(db, profile, { ttlHours: 24 });
      createdProfiles.push(guest.profile.id);
      await claimGuestProfile(db, guest.token!, account);
      const saved = await getProfile(db, undefined, undefined, account);
      expect(saved.id).toBe(guest.profile.id);
      expect(saved.expiresAt).toBeNull();
      expect(saved.anonymousSessionId).toBeNull();
      await expect(getProfile(db, guest.token!)).rejects.toMatchObject({ status: 404 });
      await expect(getProfile(db, undefined, saved.id, otherAccount)).rejects.toMatchObject({
        status: 404,
      });
      const secondGuest = await saveProfile(db, profile, { ttlHours: 24 });
      createdProfiles.push(secondGuest.profile.id);
      await claimGuestProfile(db, secondGuest.token!, account);
      expect((await getProfile(db, undefined, undefined, account)).id).toBe(saved.id);
      expect((await getProfile(db, secondGuest.token!)).id).toBe(secondGuest.profile.id);
      const updated = await saveProfile(
        db,
        { ...profile, interests: ['testing'] },
        { authUserId: account, ttlHours: 24 },
      );
      expect(updated.profile.id).toBe(saved.id);
      expect(updated.token).toBeNull();
      const env = readEnv({ NODE_ENV: 'test', DATABASE_URL: databaseUrl!, REDIS_URL: redisUrl! });
      const accountApp = createApp({
        db,
        env,
        logger: pino({ level: 'silent' }),
        auth: () => ({
          getUser: async () => ({ id: otherAccount, name: 'Other contributor', email: null }),
          start: async () => '',
          exchange: async () => {
            throw new Error('not used');
          },
          signOut: async () => {},
        }),
      });
      expect((await request(accountApp).get(`/api/v1/profiles/${saved.id}`)).status).toBe(404);
      expect(
        (
          await request(accountApp)
            .patch(`/api/v1/profiles/${saved.id}`)
            .set('X-GitOrbit', '1')
            .send(profile)
        ).status,
      ).toBe(404);
      expect(
        (await request(accountApp).delete(`/api/v1/profiles/${saved.id}`).set('X-GitOrbit', '1'))
          .status,
      ).toBe(404);
      const cleanup = await queue.add('cleanup-stale-opportunities', {
        type: 'cleanup-stale-opportunities',
        mode: 'incremental',
      });
      await cleanup.waitUntilFinished(events, 15000);
      expect((await getProfile(db, undefined, undefined, account)).id).toBe(saved.id);
    });
  },
);

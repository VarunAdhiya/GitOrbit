import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import pino from 'pino';
import type { PrismaClient } from '@gitorbit/database';
import { filtersSchema } from '@gitorbit/shared';
import { createApp } from '../apps/api/src/app.ts';
import { readEnv } from '../packages/shared/src/env.ts';
import { getProfile, sessionHash } from '../apps/api/src/profiles.ts';
import { listOpportunities, opportunityWhere } from '../apps/api/src/opportunities.ts';
import { profile } from './fixtures.ts';
const env = readEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://localhost/test',
  REDIS_URL: 'redis://localhost:6379',
  ADMIN_TOKEN: 'test-admin-token-with-at-least-32-characters',
});
const logger = pino({ level: 'silent' });
const signedInAuth = () => ({
  getUser: async () => ({
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Test user',
    email: null,
  }),
  start: async () => '',
  exchange: async () => {
    throw new Error('unused');
  },
  signOut: async () => {},
});
function fakeDatabase() {
  return {
    userProfile: { findFirst: vi.fn().mockResolvedValue(null), delete: vi.fn() },
    issue: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
  };
}
describe('anonymous access and API validation', () => {
  it('requires sign-in even with a legacy guest profile cookie', async () => {
    const app = createApp({ db: fakeDatabase() as unknown as PrismaClient, env, logger });
    for (const token of ['', 'a'.repeat(64)]) {
      const result = await request(app)
        .get('/api/v1/profiles/current')
        .set('Cookie', `gitorbit_session=${token}`);
      expect(result.status).toBe(401);
      expect(result.body.error.code).toBe('AUTH_REQUIRED');
    }
  });
  it('does not disguise database failures as an empty profile', async () => {
    const db = fakeDatabase();
    db.userProfile.findFirst.mockRejectedValue(new Error('Database unavailable'));
    const app = createApp({ db: db as unknown as PrismaClient, env, logger, auth: signedInAuth });
    const result = await request(app)
      .get('/api/v1/profiles/current')
      .set('Cookie', `gitorbit_session=${'a'.repeat(64)}`);
    expect(result.status).toBe(503);
    expect(result.body.error.code).toBe('SERVICE_UNAVAILABLE');
  });
  it('requires a private session credential, not a public UUID', async () => {
    const db = fakeDatabase();
    const app = createApp({ db: db as unknown as PrismaClient, env, logger });
    const response = await request(app).get(
      '/api/v1/profiles/11111111-1111-4111-8111-111111111111',
    );
    expect(response.status).toBe(401);
    expect(db.userProfile.findFirst).not.toHaveBeenCalled();
  });
  it('binds a credential hash to the requested profile and expiry', async () => {
    const db = fakeDatabase();
    await expect(
      getProfile(db as unknown as PrismaClient, 'a'.repeat(64), 'other-id'),
    ).rejects.toMatchObject({ status: 404 });
    expect(db.userProfile.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          anonymousSessionId: sessionHash('a'.repeat(64)),
          authUserId: null,
          id: 'other-id',
          expiresAt: { gt: expect.any(Date) },
        },
      }),
    );
  });
  it('rejects forged cross-origin mutations', async () => {
    const db = fakeDatabase();
    const app = createApp({ db: db as unknown as PrismaClient, env, logger, auth: signedInAuth });
    expect(
      (
        await request(app)
          .post('/api/v1/profiles')
          .set('Origin', 'https://evil.example')
          .set('X-GitOrbit', '1')
          .send(profile)
      ).status,
    ).toBe(403);
    expect((await request(app).post('/api/v1/profiles').send(profile)).status).toBe(403);
  });
  it('protects admin endpoints and handles multibyte tokens safely', async () => {
    const app = createApp({ db: fakeDatabase() as unknown as PrismaClient, env, logger });
    expect((await request(app).get('/api/v1/admin/ingestion')).status).toBe(401);
    expect(
      (
        await request(app)
          .get('/api/v1/admin/ingestion')
          .set('Authorization', `Bearer ${'é'.repeat(env.ADMIN_TOKEN!.length)}`)
      ).status,
    ).toBe(401);
  });
  it('validates pagination before querying the database', async () => {
    const db = fakeDatabase();
    const app = createApp({ db: db as unknown as PrismaClient, env, logger });
    const result = await request(app).get('/api/v1/opportunities?limit=90000');
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe('VALIDATION_ERROR');
    expect(db.issue.findMany).not.toHaveBeenCalled();
  });
  it('requires sign-in before processing a resume', async () => {
    const extract = vi.fn();
    const app = createApp({ db: fakeDatabase() as unknown as PrismaClient, env, logger, extract });
    expect((await request(app).post('/api/v1/resumes/analyze').set('X-GitOrbit', '1')).status).toBe(
      401,
    );
    expect(extract).not.toHaveBeenCalled();
  });
  it.each([
    ['post', '/api/v1/profiles'],
    ['patch', '/api/v1/profiles/11111111-1111-4111-8111-111111111111'],
    ['delete', '/api/v1/profiles/11111111-1111-4111-8111-111111111111'],
    ['get', '/api/v1/recommendations'],
  ] as const)('rejects unsigned %s %s before accessing profile data', async (method, path) => {
    const db = fakeDatabase();
    const app = createApp({ db: db as unknown as PrismaClient, env, logger });
    const pending = request(app)[method](path);
    const result = await pending
      .set('X-GitOrbit', '1')
      .set('Cookie', `gitorbit_session=${'a'.repeat(64)}`)
      .send(profile);
    expect(result.status).toBe(401);
    expect(result.body.error.code).toBe('AUTH_REQUIRED');
    expect(db.userProfile.findFirst).not.toHaveBeenCalled();
  });
  it('returns consistent JSON errors on unknown routes', async () => {
    const app = createApp({ db: fakeDatabase() as unknown as PrismaClient, env, logger });
    expect((await request(app).get('/api/v1/missing')).body.error.code).toBe('NOT_FOUND');
  });
});
describe('filtering and stable pagination', () => {
  it('always excludes closed, stale, old and archived issues', () => {
    const now = new Date();
    expect(opportunityWhere(filtersSchema.parse({}), 48, now)).toMatchObject({
      AND: [
        {
          state: 'open',
          stale: false,
          repository: { archived: false },
          lastSyncedAt: { gte: new Date(now.getTime() - 48 * 3600000) },
        },
      ],
    });
  });
  it('combines filters rather than overwriting restrictions', () => {
    const where = opportunityWhere(
      filtersSchema.parse({
        q: 'react',
        language: 'TypeScript',
        difficulty: 'beginner',
        available: 'true',
        program: '11111111-1111-4111-8111-111111111111',
      }),
      48,
    );
    expect(where.AND).toHaveLength(6);
    expect(JSON.stringify(where)).toContain('verifiedAt');
  });
  it('bounds and offsets query pagination deterministically', async () => {
    const db = fakeDatabase();
    await listOpportunities(
      db as unknown as PrismaClient,
      filtersSchema.parse({ page: 3, limit: 10 }),
      48,
    );
    expect(db.issue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 10,
        skip: 20,
        orderBy: [{ updatedAtSource: 'desc' }, { id: 'asc' }],
      }),
    );
  });
  it('honors preferred languages without labeling them issue prerequisites', async () => {
    const db = fakeDatabase();
    await listOpportunities(
      db as unknown as PrismaClient,
      filtersSchema.parse({ sort: 'match' }),
      48,
      profile,
    );
    expect(JSON.stringify(db.issue.findMany.mock.calls[0])).toContain('hasSome');
  });
  it('uses the selected primary language instead of implicit profile preferences', async () => {
    const db = fakeDatabase();
    await listOpportunities(
      db as unknown as PrismaClient,
      filtersSchema.parse({ language: 'Python', sort: 'match' }),
      48,
      profile,
    );
    const query = db.issue.findMany.mock.calls[0][0];
    expect(query.where.AND).toContainEqual({
      repository: { primaryLanguage: { equals: 'Python', mode: 'insensitive' } },
    });
    expect(JSON.stringify(query)).not.toContain('hasSome');
  });
});

import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import pino from 'pino';
import { createHash } from 'node:crypto';
import type { PrismaClient } from '@gitorbit/database';
import { createApp } from '../apps/api/src/app.ts';
import { authFactory, type AuthClient } from '../apps/api/src/auth.ts';
import { readEnv } from '../packages/shared/src/env.ts';
import { getProfile, claimGuestProfile, sessionHash } from '../apps/api/src/profiles.ts';

const env = readEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://localhost/test',
  REDIS_URL: 'redis://localhost:6379',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
});
const logger = pino({ level: 'silent' });
const user = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'test@example.com',
  name: 'Test Contributor',
};
function database() {
  return {
    userProfile: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
}
function client(): AuthClient {
  return {
    getUser: vi.fn().mockResolvedValue(user),
    start: vi
      .fn()
      .mockResolvedValue('https://example.supabase.co/auth/v1/authorize?provider=google'),
    exchange: vi.fn().mockResolvedValue(user),
    signOut: vi.fn().mockResolvedValue(undefined),
  };
}

describe('Google authentication routes', () => {
  it('returns an empty current profile for a signed-in account without a saved profile', async () => {
    const db = database();
    const app = createApp({ db: db as unknown as PrismaClient, env, logger, auth: () => client() });
    const result = await request(app).get('/api/v1/profiles/current');
    expect(result.status).toBe(200);
    expect(result.body).toBeNull();
    expect(db.userProfile.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { authUserId: user.id },
      }),
    );
  });
  it('requires same-origin intent for sign-in and sign-out', async () => {
    const auth = client();
    const app = createApp({
      db: database() as unknown as PrismaClient,
      env,
      logger,
      auth: () => auth,
    });
    expect((await request(app).post('/api/v1/auth/google')).status).toBe(403);
    expect(
      (
        await request(app)
          .post('/api/v1/auth/sign-out')
          .set('X-GitOrbit', '1')
          .set('Origin', 'https://evil.example')
      ).status,
    ).toBe(403);
    expect(auth.start).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
  });
  it('returns verified identity without tokens and disables caching', async () => {
    const app = createApp({
      db: database() as unknown as PrismaClient,
      env,
      logger,
      auth: () => client(),
    });
    const response = await request(app).get('/api/v1/auth/session');
    expect(response.body).toEqual({ configured: true, user });
    expect(response.headers['cache-control']).toContain('no-store');
  });
  it('never redirects callback errors to a caller-supplied address', async () => {
    const auth = client();
    const app = createApp({
      db: database() as unknown as PrismaClient,
      env,
      logger,
      auth: () => auth,
    });
    const response = await request(app).get(
      '/api/v1/auth/callback?error=access_denied&next=https://evil.example',
    );
    expect(response.headers.location).toBe('http://localhost:3000/sign-in?error=sign_in_failed');
    expect(auth.exchange).not.toHaveBeenCalled();
  });
  it('claims a guest profile only after exchanging and verifying the code', async () => {
    const db = database();
    const auth = client();
    const app = createApp({ db: db as unknown as PrismaClient, env, logger, auth: () => auth });
    const response = await request(app)
      .get('/api/v1/auth/callback?code=valid')
      .set('Cookie', `gitorbit_session=${'a'.repeat(64)}`);
    expect(auth.exchange).toHaveBeenCalledWith('valid');
    expect(db.userProfile.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { authUserId: user.id, anonymousSessionId: null, expiresAt: null },
      }),
    );
    expect(response.headers.location).toBe('http://localhost:3000/resume?auth=success');
    expect(response.headers['set-cookie'][0]).toContain('gitorbit_session=;');
  });
  it('does not transfer a profile if the code exchange fails', async () => {
    const db = database();
    const auth = client();
    vi.mocked(auth.exchange).mockRejectedValue(new Error('invalid code'));
    const app = createApp({ db: db as unknown as PrismaClient, env, logger, auth: () => auth });
    const response = await request(app)
      .get('/api/v1/auth/callback?code=invalid')
      .set('Cookie', `gitorbit_session=${'a'.repeat(64)}`);
    expect(response.headers.location).toContain('error=sign_in_failed');
    expect(db.userProfile.updateMany).not.toHaveBeenCalled();
  });
  it('signs out and clears the guest cookie without deleting the saved profile', async () => {
    const auth = client();
    const app = createApp({
      db: database() as unknown as PrismaClient,
      env,
      logger,
      auth: () => auth,
    });
    const response = await request(app).post('/api/v1/auth/sign-out').set('X-GitOrbit', '1');
    expect(response.status).toBe(204);
    expect(auth.signOut).toHaveBeenCalled();
  });
  it('uses an HttpOnly PKCE verifier and exchanges it with the callback code', async () => {
    let challenge = '';
    let exchanged = false;
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/settings')) return Response.json({ external: { google: true } });
      if (url.includes('/token?grant_type=pkce')) {
        const body = JSON.parse(String(init?.body));
        if (
          !body.code_verifier ||
          createHash('sha256').update(body.code_verifier).digest('base64url') !== challenge
        )
          return Response.json(
            { error: 'invalid_grant', error_description: 'Invalid verifier' },
            { status: 400 },
          );
        expect(body.auth_code).toBe('oauth-code');
        exchanged = true;
        const payload = Buffer.from(
          JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 }),
        ).toString('base64url');
        return Response.json({
          access_token: `e30.${payload}.signature`,
          refresh_token: 'test-refresh',
          expires_in: 3600,
          token_type: 'bearer',
          user: { ...user, aud: 'authenticated', user_metadata: { full_name: user.name } },
        });
      }
      if (url.endsWith('/user'))
        return Response.json({
          ...user,
          aud: 'authenticated',
          user_metadata: { full_name: user.name },
        });
      throw new Error('Unexpected Auth request');
    };
    const app = createApp({
      db: database() as unknown as PrismaClient,
      env,
      logger,
      auth: authFactory(env, fetcher),
    });
    const browser = request.agent(app);
    const start = await browser.post('/api/v1/auth/google').set('X-GitOrbit', '1');
    expect(start.status).toBe(200);
    const url = new URL(start.body.url);
    challenge = url.searchParams.get('code_challenge')!;
    expect(url.searchParams.get('provider')).toBe('google');
    expect(url.searchParams.get('code_challenge_method')).toBe('s256');
    expect(url.searchParams.get('redirect_to')).toBe('http://localhost:3000/api/v1/auth/callback');
    expect(start.headers['set-cookie'][0]).toMatch(/HttpOnly/);
    expect(start.headers['set-cookie'][0]).toMatch(/SameSite=Lax/);
    expect(
      (await request(app).get('/api/v1/auth/callback?code=oauth-code')).headers.location,
    ).toContain('error=sign_in_failed');
    expect(exchanged).toBe(false);
    const callback = await browser.get('/api/v1/auth/callback?code=oauth-code');
    expect(callback.headers.location).toBe('http://localhost:3000/resume?auth=success');
    expect(exchanged).toBe(true);
    expect(
      (callback.headers['set-cookie'] as unknown as string[]).every((cookie) =>
        cookie.includes('HttpOnly'),
      ),
    ).toBe(true);
  });
  it('reports a disabled Google provider without redirecting', async () => {
    const app = createApp({
      db: database() as unknown as PrismaClient,
      env,
      logger,
      auth: authFactory(env, async () => Response.json({ external: { google: false } })),
    });
    const response = await request(app).post('/api/v1/auth/google').set('X-GitOrbit', '1');
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('GOOGLE_NOT_CONFIGURED');
  });
});

describe('account profile ownership', () => {
  it('binds account reads to the verified user, even with another profile ID or guest cookie', async () => {
    const db = database();
    await expect(
      getProfile(db as unknown as PrismaClient, 'a'.repeat(64), 'someone-else', user.id),
    ).rejects.toMatchObject({ status: 404 });
    expect(db.userProfile.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { authUserId: user.id, id: 'someone-else' } }),
    );
  });
  it('never overwrites an existing account profile when claiming a guest', async () => {
    const db = database();
    db.userProfile.findUnique.mockResolvedValue({ id: 'existing' });
    await claimGuestProfile(db as unknown as PrismaClient, 'a'.repeat(64), user.id);
    expect(db.userProfile.updateMany).not.toHaveBeenCalled();
  });
  it('only transfers an unexpired, unclaimed guest credential', async () => {
    const db = database();
    await claimGuestProfile(db as unknown as PrismaClient, 'a'.repeat(64), user.id);
    expect(db.userProfile.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          anonymousSessionId: sessionHash('a'.repeat(64)),
          authUserId: null,
          expiresAt: { gt: expect.any(Date) },
        },
      }),
    );
  });
});

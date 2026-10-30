import { createServerClient } from '@supabase/ssr';
import type { User } from '@supabase/supabase-js';
import type { Request, Response } from 'express';
import type { Env } from '../../../packages/shared/src/env.ts';
import { ApiError } from './errors.ts';

export type AuthUser = { id: string; email: string | null; name: string };
export type AuthClient = {
  getUser(): Promise<AuthUser | null>;
  start(): Promise<string>;
  exchange(code: string): Promise<AuthUser>;
  signOut(): Promise<void>;
};
export type AuthFactory = (req: Request, res: Response) => AuthClient | null;
const COOKIE_PREFIX = 'gitorbit_auth';
const unavailable = () =>
  new ApiError(503, 'AUTH_UNAVAILABLE', 'Sign-in is temporarily unavailable. Please try again.');

function publicUser(user: User): AuthUser {
  // Metadata is display-only. Ownership always uses the verified Supabase user ID.
  const name = user.user_metadata?.full_name;
  return {
    id: user.id,
    email: user.email || null,
    name: typeof name === 'string' ? name.slice(0, 100) : 'Contributor',
  };
}

export function authFactory(env: Env, fetcher: typeof fetch = fetch): AuthFactory {
  return (req, res) => {
    if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) return null;
    const secure = env.NODE_ENV === 'production';
    const client = createServerClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
      cookieOptions: { name: COOKIE_PREFIX, path: '/api', httpOnly: true, sameSite: 'lax', secure },
      global: {
        fetch: (input, init) => fetcher(input, { ...init, signal: AbortSignal.timeout(10000) }),
      },
      cookies: {
        getAll: () =>
          Object.entries(req.cookies || {}).map(([name, value]) => ({
            name,
            value: String(value),
          })),
        setAll: (cookies, headers) => {
          for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
          for (const { name, value, options } of cookies) {
            req.cookies[name] = value;
            // Supabase cookie maxAge is seconds; Express expects milliseconds.
            res.cookie(name, value, {
              ...options,
              maxAge: options.maxAge === undefined ? undefined : options.maxAge * 1000,
              httpOnly: true,
              sameSite: 'lax',
              secure,
              path: '/api',
            });
          }
        },
      },
    });
    const getUser = async () => {
      const { data, error } = await client.auth.getUser();
      if (error) {
        if (
          error.name === 'AuthSessionMissingError' ||
          (error.status && [400, 401, 403].includes(error.status))
        )
          return null;
        throw unavailable();
      }
      return data.user ? publicUser(data.user) : null;
    };
    return {
      getUser,
      async start() {
        // Detect a disabled provider before sending the user to a dead-end OAuth page.
        const response = await fetcher(`${env.SUPABASE_URL}/auth/v1/settings`, {
          headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY! },
          signal: AbortSignal.timeout(10000),
        }).catch(() => {
          throw unavailable();
        });
        if (!response.ok) throw unavailable();
        const settings = (await response.json()) as { external?: { google?: boolean } };
        if (!settings.external?.google)
          throw new ApiError(
            503,
            'GOOGLE_NOT_CONFIGURED',
            'Google sign-in is not available yet. You can continue as a guest.',
          );
        const { data, error } = await client.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: `${env.WEB_ORIGIN}/api/v1/auth/callback`,
            skipBrowserRedirect: true,
            queryParams: { prompt: 'select_account' },
          },
        });
        if (error || !data.url) throw unavailable();
        return data.url;
      },
      async exchange(code) {
        const { error } = await client.auth.exchangeCodeForSession(code);
        if (error)
          throw new ApiError(
            401,
            'SIGN_IN_FAILED',
            'Sign-in could not be completed. Please try again.',
          );
        const user = await getUser();
        if (!user) throw new ApiError(401, 'SIGN_IN_FAILED', 'Sign-in could not be verified.');
        return user;
      },
      async signOut() {
        const { error } = await client.auth.signOut({ scope: 'local' });
        if (error) throw unavailable();
        for (const name of Object.keys(req.cookies || {})) {
          if (
            name === COOKIE_PREFIX ||
            name.startsWith(`${COOKIE_PREFIX}.`) ||
            name.startsWith(`${COOKIE_PREFIX}-`)
          )
            res.clearCookie(name, { path: '/api', httpOnly: true, sameSite: 'lax', secure });
        }
      },
    };
  };
}

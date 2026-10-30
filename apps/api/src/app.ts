import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { z, ZodError } from 'zod';
import type { Logger } from 'pino';
import type { Redis } from 'ioredis';
import type { Queue } from 'bullmq';
import type { PrismaClient } from '@gitorbit/database';
import {
  filtersSchema,
  opportunityPageSchema,
  validateResponse,
  jobPayloadSchema,
  profileInputSchema,
  type JobPayload,
} from '@gitorbit/shared';
import type { Env } from '../../../packages/shared/src/env.ts';
import { ApiError } from './errors.ts';
import {
  COOKIE_NAME,
  getProfile,
  saveProfile,
  serializeProfile,
  claimGuestProfile,
} from './profiles.ts';
import { authFactory, type AuthFactory } from './auth.ts';
import {
  analyzeResume,
  analysisProfile,
  extractPdf,
  MAX_PDF_BYTES,
  validatePdf,
  type ResumeAnalysis,
} from './resume.ts';
import { listOpportunities, opportunityWhere, serializeOpportunity } from './opportunities.ts';
type Dependencies = {
  db: PrismaClient;
  env: Env;
  logger: Logger;
  redis?: Redis;
  queue?: Queue<JobPayload>;
  extract?: typeof extractPdf;
  analyze?: (text: string) => Promise<ResumeAnalysis>;
  auth?: AuthFactory;
};
export function createApp({
  db,
  env,
  logger,
  redis,
  queue,
  extract = extractPdf,
  analyze = (text) => analyzeResume(text, env),
  auth = authFactory(env),
}: Dependencies) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  app.use(helmet());
  app.use(
    cors({
      origin: env.WEB_ORIGIN,
      credentials: true,
      allowedHeaders: ['Content-Type', 'X-GitOrbit', 'Authorization'],
    }),
  );
  const store = (prefix: string) =>
    redis
      ? new RedisStore({
          prefix,
          sendCommand: (...args: string[]) =>
            redis.call(args[0], ...args.slice(1)) as Promise<number>,
        })
      : undefined;
  const limitMessage = {
    error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait and try again.' },
  };
  app.use(
    '/api',
    rateLimit({
      windowMs: 60000,
      limit: 120,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      store: store('gitorbit:api-limit:'),
      message: limitMessage,
    }),
  );
  app.use(express.json({ limit: '64kb' }));
  app.use(cookieParser());
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  const mutation: RequestHandler = (req, _res, next) => {
    if (
      req.get('X-GitOrbit') !== '1' ||
      (req.get('Origin') && req.get('Origin') !== env.WEB_ORIGIN)
    )
      return next(new ApiError(403, 'ORIGIN_REJECTED', 'This request could not be verified.'));
    next();
  };
  const cookieOptions = {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/api',
  };
  app.get('/api/v1/auth/session', async (req, res) => {
    const client = auth(req, res);
    res.json({ configured: Boolean(client), user: client ? await client.getUser() : null });
  });
  app.post('/api/v1/auth/google', mutation, async (req, res) => {
    const client = auth(req, res);
    if (!client)
      throw new ApiError(
        503,
        'AUTH_NOT_CONFIGURED',
        'Google sign-in is not available yet. You can continue as a guest.',
      );
    res.json({ url: await client.start() });
  });
  app.get('/api/v1/auth/callback', async (req, res) => {
    const code = z.string().min(1).max(4096).safeParse(req.query.code);
    const client = auth(req, res);
    if (!client || req.query.error || !code.success) {
      res.redirect(303, `${env.WEB_ORIGIN}/sign-in?error=sign_in_failed`);
      return;
    }
    try {
      const user = await client.exchange(code.data);
      await claimGuestProfile(db, req.cookies[COOKIE_NAME], user.id);
      res.clearCookie(COOKIE_NAME, cookieOptions);
      res.redirect(303, `${env.WEB_ORIGIN}/resume?auth=success`);
    } catch {
      logger.warn({ code: 'AUTH_CALLBACK_FAILED' }, 'Google sign-in callback could not complete');
      res.redirect(303, `${env.WEB_ORIGIN}/sign-in?error=sign_in_failed`);
    }
  });
  app.post('/api/v1/auth/sign-out', mutation, async (req, res) => {
    await auth(req, res)?.signOut();
    res.clearCookie(COOKIE_NAME, cookieOptions);
    res.status(204).end();
  });
  app.use(
    ['/api/v1/profiles', '/api/v1/resumes', '/api/v1/recommendations'],
    async (req, res, next) => {
      res.locals.authUser = (await auth(req, res)?.getUser()) || null;
      if (!res.locals.authUser)
        throw new ApiError(
          401,
          'AUTH_REQUIRED',
          'Sign in to upload a resume, manage your profile, and get personalized recommendations.',
        );
      next();
    },
  );
  app.get('/api/v1/config', (_req, res) =>
    res.json({
      aiConfigured: Boolean(env.LLM_API_KEY),
      maxPdfMb: MAX_PDF_BYTES / 1024 / 1024,
    }),
  );
  app.get('/api/v1/health', async (_req, res) => {
    try {
      await db.$queryRaw`SELECT 1`;
      if (redis) await redis.ping();
      res.json({ status: 'ok', database: 'ok', redis: redis ? 'ok' : 'not-configured' });
    } catch {
      res.status(503).json({
        status: 'degraded',
        error: { code: 'SERVICE_UNAVAILABLE', message: 'Database or queue is unavailable.' },
      });
    }
  });
  app.get('/api/v1/profiles/:id', async (req, res) => {
    const id = req.params.id === 'current' ? undefined : z.string().uuid().parse(req.params.id);
    try {
      res.json(
        serializeProfile(
          await getProfile(db, req.cookies[COOKIE_NAME], id, res.locals.authUser?.id),
        ),
      );
    } catch (error) {
      if (
        !id &&
        error instanceof ApiError &&
        ['PROFILE_REQUIRED', 'PROFILE_NOT_FOUND'].includes(error.code)
      ) {
        res.json(null);
        return;
      }
      throw error;
    }
  });
  app.post('/api/v1/profiles', mutation, async (req, res) => {
    const input = profileInputSchema.parse(req.body);
    const result = await saveProfile(
      db,
      { ...input, skills: input.skills.map((s) => ({ ...s, source: 'user', confidence: 1 })) },
      {
        token: req.cookies[COOKIE_NAME],
        authUserId: res.locals.authUser?.id,
        ttlHours: env.PROFILE_TTL_HOURS,
      },
    );
    if (result.token) res.cookie(COOKIE_NAME, result.token, cookieOptions);
    else res.clearCookie(COOKIE_NAME, cookieOptions);
    res.status(201).json(result.profile);
  });
  app.patch('/api/v1/profiles/:id', mutation, async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const input = profileInputSchema.parse(req.body);
    const result = await saveProfile(
      db,
      { ...input, skills: input.skills.map((s) => ({ ...s, source: 'user', confidence: 1 })) },
      {
        token: req.cookies[COOKIE_NAME],
        authUserId: res.locals.authUser?.id,
        id,
        ttlHours: env.PROFILE_TTL_HOURS,
      },
    );
    res.json(result.profile);
  });
  app.delete('/api/v1/profiles/:id', mutation, async (req, res) => {
    const profile = await getProfile(
      db,
      req.cookies[COOKIE_NAME],
      z.string().uuid().parse(req.params.id),
      res.locals.authUser?.id,
    );
    await db.userProfile.delete({ where: { id: profile.id } });
    res.clearCookie(COOKIE_NAME, cookieOptions).status(204).end();
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_PDF_BYTES, files: 1, fields: 0, parts: 1 },
    fileFilter: (_req, file, callback) => {
      if (file.mimetype !== 'application/pdf')
        callback(new ApiError(415, 'PDF_TYPE', 'Please upload a PDF file.'));
      else callback(null, true);
    },
  });
  app.post(
    '/api/v1/resumes/analyze',
    mutation,
    rateLimit({
      windowMs: 3600000,
      limit: 6,
      store: store('gitorbit:upload-limit:'),
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: limitMessage,
    }),
    (_req, _res, next) => {
      if (!env.LLM_API_KEY)
        return next(
          new ApiError(
            503,
            'AI_NOT_CONFIGURED',
            'Resume analysis is not configured yet. Add your skills manually.',
          ),
        );
      next();
    },
    upload.single('resume'),
    async (req, res) => {
      if (!req.file) throw new ApiError(400, 'FILE_REQUIRED', 'Choose a PDF resume to continue.');
      const lease = randomUUID();
      let acquired = false;
      try {
        validatePdf(req.file.buffer, req.file.mimetype);
        if (redis) {
          acquired =
            Number(
              await redis.eval(
                "redis.call('zremrangebyscore',KEYS[1],'-inf',ARGV[1]); if redis.call('zcard',KEYS[1]) >= 3 then return 0 end; redis.call('zadd',KEYS[1],ARGV[2],ARGV[3]); redis.call('expire',KEYS[1],90); return 1",
                1,
                'gitorbit:resume-slots',
                Date.now(),
                Date.now() + 90000,
                lease,
              ),
            ) === 1;
          if (!acquired)
            throw new ApiError(
              429,
              'ANALYSIS_BUSY',
              'Resume analysis is busy. Please try again in a minute.',
            );
        }
        const text = await extract(req.file.buffer);
        const analysis = await analyze(text);
        const result = await saveProfile(db, analysisProfile(analysis), {
          token: req.cookies[COOKIE_NAME],
          authUserId: res.locals.authUser?.id,
          ttlHours: env.PROFILE_TTL_HOURS,
          inferred: true,
          experienceSummary: analysis.experienceSummary,
        });
        if (result.token) res.cookie(COOKIE_NAME, result.token, cookieOptions);
        else res.clearCookie(COOKIE_NAME, cookieOptions);
        res.status(201).json(result.profile);
      } finally {
        req.file.buffer.fill(0);
        if (acquired) await redis?.zrem('gitorbit:resume-slots', lease).catch(() => {});
      }
    },
  );
  app.get('/api/v1/opportunities/facets', async (_req, res) => {
    const where = opportunityWhere(filtersSchema.parse({}), env.STALE_HOURS);
    const [repos, programs, total, latest, skills, languages] = await Promise.all([
      db.repository.findMany({
        where: { issues: { some: where } },
        select: { id: true, name: true, owner: true, languages: true },
        orderBy: { stars: 'desc' },
        take: 1000,
      }),
      db.program.findMany({
        where: { verifiedAt: { not: null }, issues: { some: { issue: where } } },
        select: { id: true, name: true },
        take: 100,
      }),
      db.issue.count({ where }),
      db.issue.findFirst({
        where,
        orderBy: { lastSyncedAt: 'desc' },
        select: { lastSyncedAt: true },
      }),
      db.issue.findMany({
        where,
        select: { relevantSkills: true },
        take: 1000,
        orderBy: { updatedAtSource: 'desc' },
      }),
      db.repository.groupBy({
        by: ['primaryLanguage'],
        where: { issues: { some: where }, primaryLanguage: { not: null } },
        orderBy: { primaryLanguage: 'asc' },
      }),
    ]);
    res.json({
      languages: languages
        .map((r) => r.primaryLanguage)
        .filter((language): language is string => Boolean(language)),
      skills: [...new Set(skills.flatMap((i) => i.relevantSkills))].sort(),
      programs,
      repositories: repos.map(({ languages: _l, ...r }) => r),
      total,
      lastSyncedAt: latest?.lastSyncedAt || null,
    });
  });
  app.get('/api/v1/opportunities', async (req, res) => {
    const filters = filtersSchema.parse(req.query);
    if (filters.sort === 'match')
      throw new ApiError(
        400,
        'PROFILE_REQUIRED',
        'Use personalized recommendations to sort by match score.',
      );
    res.json(
      validateResponse(
        opportunityPageSchema,
        await listOpportunities(db, filters, env.STALE_HOURS),
      ),
    );
  });
  app.get('/api/v1/opportunities/:id', async (req, res) => {
    const item = await db.issue.findUnique({
      where: { id: z.string().uuid().parse(req.params.id) },
      include: { repository: true },
    });
    if (!item) throw new ApiError(404, 'NOT_FOUND', 'This opportunity could not be found.');
    res.json(
      serializeOpportunity({
        ...item,
        stale: item.stale || item.lastSyncedAt.getTime() < Date.now() - env.STALE_HOURS * 3600000,
      }),
    );
  });
  app.get('/api/v1/recommendations', async (req, res) => {
    const profile = serializeProfile(
      await getProfile(db, req.cookies[COOKIE_NAME], undefined, res.locals.authUser?.id),
    );
    res.json(
      validateResponse(
        opportunityPageSchema,
        await listOpportunities(
          db,
          filtersSchema.parse({ sort: 'match', ...req.query }),
          env.STALE_HOURS,
          profile,
        ),
      ),
    );
  });
  const admin: RequestHandler = (req, _res, next) => {
    const token = req.get('Authorization')?.replace(/^Bearer /, '') || '';
    if (
      !env.ADMIN_TOKEN ||
      Buffer.byteLength(token) !== Buffer.byteLength(env.ADMIN_TOKEN) ||
      !timingSafeEqual(Buffer.from(token), Buffer.from(env.ADMIN_TOKEN))
    )
      return next(new ApiError(401, 'UNAUTHORIZED', 'Administrator credentials are required.'));
    next();
  };
  app.get('/api/v1/admin/ingestion', admin, async (_req, res) => {
    if (!queue) throw new ApiError(503, 'QUEUE_UNAVAILABLE', 'Queue is unavailable.');
    res.json({
      counts: await queue.getJobCounts(),
      schedulers: await queue.getJobSchedulers(),
      runs: await db.ingestionRun.findMany({ orderBy: { startedAt: 'desc' }, take: 50 }),
      failed: (await queue.getFailed(0, 19)).map((j) => ({
        id: j.id,
        type: j.name,
        attempts: j.attemptsMade,
        reason: j.failedReason,
      })),
    });
  });
  app.post('/api/v1/admin/ingestion/trigger', admin, async (req, res) => {
    if (!queue) throw new ApiError(503, 'QUEUE_UNAVAILABLE', 'Queue is unavailable.');
    const payload = jobPayloadSchema.parse(req.body);
    const job = await queue.add(payload.type, payload, {
      deduplication: { id: `admin-${payload.type}-${payload.mode}-${payload.language || 'all'}` },
    });
    res.status(202).json({ jobId: job.id });
  });
  app.use((_req, _res, next) => next(new ApiError(404, 'NOT_FOUND', 'Endpoint not found.')));
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof ZodError) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Please check your input.',
          fields: error.issues.map((i) => i.path.join('.')),
        },
      });
      return;
    }
    if (error instanceof multer.MulterError) {
      res
        .status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400)
        .json({ error: { code: error.code, message: 'Upload one PDF, no larger than 5 MB.' } });
      return;
    }
    if (error instanceof ApiError) {
      if (error.code.startsWith('AI_'))
        logger.warn({ code: error.code, ...error.diagnostics }, 'Resume analysis failed');
      res.status(error.status).json({ error: { code: error.code, message: error.message } });
      return;
    }
    if (error instanceof SyntaxError && 'body' in error) {
      res
        .status(400)
        .json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } });
      return;
    }
    // Never log request bodies, cookies, filenames, provider responses or Prisma query arguments.
    logger.error(
      {
        errorType: error instanceof Error ? error.name : 'unknown',
        ...(error instanceof Error &&
        'code' in error &&
        typeof error.code === 'string' &&
        /^P\d{4}$/.test(error.code)
          ? { errorCode: error.code }
          : {}),
      },
      'Request failed',
    );
    res.status(503).json({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'GitOrbit could not reach a required service. Please try again shortly.',
      },
    });
  };
  app.use(errors);
  return app;
}

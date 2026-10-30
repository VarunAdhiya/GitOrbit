import { z } from 'zod';
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().url(),
  SUPABASE_URL: z.string().url().optional().or(z.literal('')),
  SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_LANGUAGES: z.string().default('TypeScript,JavaScript,Python,Java,Go,Rust,C++'),
  LLM_API_KEY: z.string().optional(),
  LLM_BASE_URL: z.string().url().default('https://api.groq.com/openai/v1'),
  LLM_MODEL: z.string().default('openai/gpt-oss-20b'),
  LLM_PROVIDER_NAME: z.string().default('Groq'),
  ADMIN_TOKEN: z.string().min(32).optional(),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(3),
  PROFILE_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  STALE_HOURS: z.coerce.number().int().min(1).max(168).default(48),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
});
export type Env = z.infer<typeof schema>;
export function readEnv(input: NodeJS.ProcessEnv = process.env): Env {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new Error(
      `Invalid environment: ${result.error.issues.map((i) => i.path.join('.')).join(', ')}. See .env.example.`,
    );
  const env = result.data;
  if (env.NODE_ENV === 'production' && !env.WEB_ORIGIN.startsWith('https://'))
    throw new Error('WEB_ORIGIN must use HTTPS in production.');
  return env;
}

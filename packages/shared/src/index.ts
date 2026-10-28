import { z } from 'zod';

export const difficultySchema = z.enum(['beginner', 'intermediate', 'advanced', 'unknown']);
export const experienceSchema = z.enum(['beginner', 'intermediate', 'advanced', 'unknown']);
export const categorySchema = z.enum([
  'programmingLanguages',
  'frameworks',
  'databases',
  'tools',
  'domains',
]);
const shortText = z.string().trim().min(1).max(80);
export const skillSchema = z.object({
  name: shortText,
  category: categorySchema,
  confidence: z.number().min(0).max(1),
  source: z.enum(['extracted', 'user']),
});
export const profileInputSchema = z
  .object({
    skills: z.array(skillSchema).max(80),
    experienceLevel: experienceSchema,
    interests: z.array(shortText).max(15),
    preferredLanguages: z.array(shortText).max(15),
    desiredDifficulty: z.enum(['any', 'beginner', 'intermediate', 'advanced', 'unknown']),
  })
  .strict();
export const analysisSchema = z
  .object({
    skills: z
      .array(
        z
          .object({
            name: shortText,
            category: categorySchema,
            evidence: z.string().min(1).max(240),
          })
          .strict(),
      )
      .max(80),
    experienceLevel: experienceSchema,
    experienceEvidence: z.array(z.string().min(1).max(240)).max(6),
  })
  .strict();
export const filtersSchema = z
  .object({
    q: z.string().trim().max(160).default(''),
    language: z.string().trim().max(60).default(''),
    skill: z.string().trim().max(60).default(''),
    difficulty: z.enum(['any', 'beginner', 'intermediate', 'advanced', 'unknown']).default('any'),
    activity: z.enum(['any', 'month', 'quarter']).default('any'),
    repository: z.string().trim().max(100).default(''),
    program: z.string().uuid().optional(),
    sort: z.enum(['updated', 'created', 'match']).default('updated'),
    page: z.coerce.number().int().min(1).max(1000).default(1),
    limit: z.coerce.number().int().min(1).max(30).default(12),
    available: z.enum(['true', 'false']).default('false'),
  })
  .strict();
export const jobTypes = [
  'discover-repositories',
  'discover-issues',
  'sync-repository-metadata',
  'refresh-issue-status',
  'cleanup-stale-opportunities',
] as const;
export const jobPayloadSchema = z
  .object({
    type: z.enum(jobTypes),
    mode: z.enum(['incremental', 'backfill']).default('incremental'),
    language: z
      .string()
      .regex(/^[a-zA-Z0-9+#. -]{1,40}$/)
      .optional(),
    label: z.enum(['good first issue', 'help wanted']).optional(),
    cursor: z.string().uuid().optional(),
    cutoff: z.string().datetime().optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    page: z.number().int().min(1).max(10).optional(),
  })
  .strict();
export type JobPayload = z.infer<typeof jobPayloadSchema>;
export type Difficulty = z.infer<typeof difficultySchema>;
export type ProfileInput = z.infer<typeof profileInputSchema>;
export type Profile = ProfileInput & {
  id: string;
  experienceInferred: boolean;
  experienceSummary: string[];
  expiresAt: string;
};
export type Filters = z.infer<typeof filtersSchema>;

const aliases: Record<string, string> = {
  js: 'JavaScript',
  javascript: 'JavaScript',
  ts: 'TypeScript',
  typescript: 'TypeScript',
  python: 'Python',
  java: 'Java',
  go: 'Go',
  golang: 'Go',
  rust: 'Rust',
  'c++': 'C++',
  cpp: 'C++',
  'c#': 'C#',
  csharp: 'C#',
  react: 'React',
  reactjs: 'React',
  'react.js': 'React',
  nextjs: 'Next.js',
  'next.js': 'Next.js',
  nodejs: 'Node.js',
  'node.js': 'Node.js',
  express: 'Express',
  expressjs: 'Express',
  postgres: 'PostgreSQL',
  postgresql: 'PostgreSQL',
  mongodb: 'MongoDB',
  docker: 'Docker',
  git: 'Git',
  aws: 'AWS',
  redis: 'Redis',
  vue: 'Vue',
  'vue.js': 'Vue',
  angular: 'Angular',
  django: 'Django',
  flask: 'Flask',
  fastapi: 'FastAPI',
  kubernetes: 'Kubernetes',
  terraform: 'Terraform',
  graphql: 'GraphQL',
  html: 'HTML',
  css: 'CSS',
  sql: 'SQL',
  svelte: 'Svelte',
  ruby: 'Ruby',
  php: 'PHP',
  swift: 'Swift',
  kotlin: 'Kotlin',
  tailwind: 'Tailwind CSS',
  'tailwind css': 'Tailwind CSS',
};
export function normalizeSkill(name: string) {
  const clean = name.trim().replace(/\s+/g, ' ');
  return aliases[clean.toLowerCase()] || clean;
}
export function skillKey(name: string) {
  return normalizeSkill(name).toLowerCase();
}
export function normalizeSkills(skills: ProfileInput['skills']) {
  return [
    ...new Map(
      skills.map((s) => [skillKey(s.name), { ...s, name: normalizeSkill(s.name) }]),
    ).values(),
  ];
}
export function containsTerm(text: string, term: string) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![a-zA-Z0-9])${escaped}(?![a-zA-Z0-9])`, 'i').test(text);
}
export function detectSkills(text: string) {
  // Explicit text mentions only. Repository languages are kept separate.
  return [
    ...new Set(
      Object.entries(aliases)
        .filter(([term]) =>
          term === 'go' ? /(?<![a-zA-Z0-9])Go(?![a-zA-Z0-9])/.test(text) : containsTerm(text, term),
        )
        .map(([, name]) => name),
    ),
  ];
}
export function inferDifficulty(labels: string[]): { difficulty: Difficulty; evidence: string } {
  const values = labels.map((s) => s.toLowerCase());
  if (values.some((s) => ['good first issue', 'beginner', 'easy', 'difficulty: easy'].includes(s)))
    return {
      difficulty: 'beginner',
      evidence: 'Maintainer label identifies a beginner-friendly issue.',
    };
  if (values.some((s) => ['advanced', 'hard', 'difficulty: hard'].includes(s)))
    return { difficulty: 'advanced', evidence: 'Maintainer label indicates advanced scope.' };
  if (values.some((s) => ['intermediate', 'medium', 'difficulty: medium'].includes(s)))
    return {
      difficulty: 'intermediate',
      evidence: 'Maintainer label indicates intermediate scope.',
    };
  return {
    difficulty: 'unknown',
    evidence:
      'The available labels do not establish difficulty. Review scope and contribution guidance.',
  };
}
export type RepositoryView = {
  id: string;
  owner: string;
  name: string;
  description: string | null;
  sourceUrl: string;
  primaryLanguage: string | null;
  languages: string[];
  topics: string[];
  stars: number;
  forks: number;
  archived: boolean;
  contributionUrl: string | null;
  lastPushedAt: string | null;
  createdAtSource: string;
  lastSyncedAt: string;
};
export type Opportunity = {
  id: string;
  title: string;
  description: string;
  issueNumber: number;
  sourceUrl: string;
  labels: string[];
  state: string;
  assigned: boolean;
  inProgress: boolean;
  difficulty: string;
  difficultyEvidence: string;
  relevantSkills: string[];
  createdAtSource: string;
  updatedAtSource: string;
  lastSyncedAt: string;
  stale: boolean;
  repository: RepositoryView;
  match?: Match;
};
export type Match = {
  score: number;
  skillScore: number;
  difficultyScore: number;
  activityScore: number;
  interestScore: number;
  matchingSkills: string[];
  uncertainPrerequisites: string[];
  explanation: string;
  activitySummary: string;
};
export type OpportunityPage = {
  items: Opportunity[];
  total: number;
  page: number;
  limit: number;
  pages: number;
  rankedCandidates?: number;
  rankingLimited?: boolean;
};
export type Facets = {
  languages: string[];
  skills: string[];
  programs: { id: string; name: string }[];
  repositories: { id: string; owner: string; name: string }[];
  total: number;
  lastSyncedAt: string | null;
};

// Runtime response contracts strip persistence-only fields at the HTTP boundary.
export const profileResponseSchema = profileInputSchema.extend({
  id: z.string().uuid(),
  experienceInferred: z.boolean(),
  experienceSummary: z.array(z.string().max(240)).max(6),
  expiresAt: z.string().datetime(),
});
const scoreSchema = z.number().min(0).max(100);
export const matchResponseSchema = z.object({
  score: scoreSchema,
  skillScore: scoreSchema,
  difficultyScore: scoreSchema,
  activityScore: scoreSchema,
  interestScore: scoreSchema,
  matchingSkills: z.array(z.string()),
  uncertainPrerequisites: z.array(z.string()),
  explanation: z.string(),
  activitySummary: z.string(),
});
export const opportunityResponseSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string(),
  issueNumber: z.number().int(),
  sourceUrl: z.string().url(),
  labels: z.array(z.string()),
  state: z.string(),
  assigned: z.boolean(),
  inProgress: z.boolean(),
  difficulty: difficultySchema,
  difficultyEvidence: z.string(),
  relevantSkills: z.array(z.string()),
  createdAtSource: z.string().datetime(),
  updatedAtSource: z.string().datetime(),
  lastSyncedAt: z.string().datetime(),
  stale: z.boolean(),
  repository: z.object({
    id: z.string().uuid(),
    owner: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    sourceUrl: z.string().url(),
    primaryLanguage: z.string().nullable(),
    languages: z.array(z.string()),
    topics: z.array(z.string()),
    stars: z.number().int(),
    forks: z.number().int(),
    archived: z.boolean(),
    contributionUrl: z.string().url().nullable(),
    lastPushedAt: z.string().datetime().nullable(),
    createdAtSource: z.string().datetime(),
    lastSyncedAt: z.string().datetime(),
  }),
  match: matchResponseSchema.optional(),
});
export const opportunityPageSchema = z.object({
  items: z.array(opportunityResponseSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().min(1).max(30),
  pages: z.number().int().nonnegative(),
  rankedCandidates: z.number().int().optional(),
  rankingLimited: z.boolean().optional(),
});
export function validateResponse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error('Internal response contract validation failed.');
  return result.data;
}

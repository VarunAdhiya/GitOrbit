import { z } from 'zod';
import { detectSkills, inferDifficulty } from '@gitorbit/shared';
import type { OpportunityProvider, DiscoveredIssue } from './provider.ts';
const date = z.string().datetime();
const githubUrl = z
  .string()
  .url()
  .refine((s) => new URL(s).hostname === 'github.com' && s.startsWith('https://'));
export const repositorySchema = z.object({
  id: z.number().int(),
  owner: z.object({ login: z.string() }),
  name: z.string(),
  description: z.string().nullable(),
  html_url: githubUrl,
  language: z.string().nullable(),
  stargazers_count: z.number().int(),
  forks_count: z.number().int(),
  topics: z.array(z.string()).default([]),
  archived: z.boolean(),
  pushed_at: date.nullable(),
  created_at: date,
  default_branch: z.string().default('main'),
});
export const issueSchema = z.object({
  id: z.number().int(),
  number: z.number().int(),
  title: z.string().max(1000),
  body: z.string().nullable().default(''),
  html_url: githubUrl,
  repository_url: z.string().url().optional(),
  state: z.enum(['open', 'closed']),
  labels: z.array(z.union([z.string(), z.object({ name: z.string() })])),
  assignees: z.array(z.object({ login: z.string() })).default([]),
  created_at: date,
  updated_at: date,
  pull_request: z.unknown().optional(),
});
export type GitHubRepository = z.infer<typeof repositorySchema>;
export type GitHubIssue = z.infer<typeof issueSchema>;
export class RateLimitError extends Error {
  constructor(public delay: number) {
    super('GitHub rate limit; retry scheduled.');
  }
}
export class SourceError extends Error {
  constructor(public status: number) {
    super(`GitHub returned HTTP ${status}`);
  }
}
export function retryDelay(headers: Headers, now = Date.now()) {
  const retry = headers.get('retry-after');
  const retryMs = retry
    ? /^\d+$/.test(retry)
      ? Number(retry) * 1000
      : Date.parse(retry) - now
    : 0;
  const reset = Number(headers.get('x-ratelimit-reset') || 0) * 1000 - now;
  return Math.max(
    60000,
    Number.isFinite(retryMs) ? retryMs : 0,
    headers.get('x-ratelimit-remaining') === '0' ? reset + 1000 : 0,
  );
}
export function normalizeRepository(
  raw: unknown,
  languages: string[] = [],
  contributionUrl: string | null = null,
) {
  const r = repositorySchema.parse(raw);
  return {
    source: 'github',
    externalId: String(r.id),
    owner: r.owner.login,
    name: r.name,
    description: r.description,
    sourceUrl: r.html_url,
    primaryLanguage: r.language,
    languages,
    topics: r.topics,
    stars: r.stargazers_count,
    forks: r.forks_count,
    archived: r.archived,
    contributionUrl,
    createdAtSource: new Date(r.created_at),
    lastPushedAt: r.pushed_at ? new Date(r.pushed_at) : null,
    lastSyncedAt: new Date(),
  };
}
export function normalizeIssue(raw: unknown) {
  const i = issueSchema.parse(raw);
  if (i.pull_request !== undefined) return null;
  const labels = i.labels.map((l) => (typeof l === 'string' ? l : l.name));
  const difficulty = inferDifficulty(labels);
  return {
    source: 'github',
    externalId: String(i.id),
    issueNumber: i.number,
    title: i.title,
    description: (i.body || '').slice(0, 60000),
    sourceUrl: i.html_url,
    labels,
    state: i.state,
    assigned: i.assignees.length > 0,
    inProgress: labels.some((l) => /^(in progress|in-progress|status: in progress)$/i.test(l)),
    difficulty: difficulty.difficulty,
    difficultyEvidence: difficulty.evidence,
    relevantSkills: detectSkills(`${i.title} ${i.body || ''} ${labels.join(' ')}`),
    createdAtSource: new Date(i.created_at),
    updatedAtSource: new Date(i.updated_at),
    lastSyncedAt: new Date(),
    stale: false,
  };
}
function discoveredIssue(raw: GitHubIssue): DiscoveredIssue | null {
  const issue = normalizeIssue(raw);
  if (!issue) return null;
  const [, owner, name] = new URL(raw.html_url).pathname.split('/');
  if (!owner || !name) throw new Error('GitHub issue is missing repository identity.');
  return { issue, repository: { owner, name } };
}
export class GitHubProvider implements OpportunityProvider {
  source = 'github';
  private cooldownUntil = 0;
  constructor(
    private token: string,
    private fetcher: typeof fetch = fetch,
    private throttle: () => Promise<void> = async () => {},
  ) {}
  async request(path: string) {
    if (Date.now() < this.cooldownUntil) throw new RateLimitError(this.cooldownUntil - Date.now());
    await this.throttle();
    const response = await this.fetcher(`https://api.github.com${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'GitOrbit',
      },
      signal: AbortSignal.timeout(20000),
    });
    if (
      response.status === 429 ||
      (response.status === 403 &&
        (response.headers.has('retry-after') ||
          response.headers.get('x-ratelimit-remaining') === '0'))
    )
      throw new RateLimitError(retryDelay(response.headers));
    if (response.status === 403) {
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      if (/secondary rate|rate limit|abuse/i.test(body.message || ''))
        throw new RateLimitError(Math.max(60000, retryDelay(response.headers)));
      throw new SourceError(403);
    }
    if (!response.ok) throw new SourceError(response.status);
    if (response.headers.get('x-ratelimit-remaining') === '0')
      this.cooldownUntil = Date.now() + retryDelay(response.headers);
    return response.json() as Promise<unknown>;
  }
  async *searchIssues(
    language: string,
    label: string,
    from: Date,
    to: Date,
  ): AsyncGenerator<DiscoveredIssue> {
    const q = `is:issue is:open archived:false label:"${label}" language:"${language}" updated:${from.toISOString()}..${to.toISOString()}`;
    const schema = z.object({
      total_count: z.number(),
      incomplete_results: z.boolean(),
      items: z.array(issueSchema),
    });
    const first = schema.parse(
      await this.request(
        `/search/issues?${new URLSearchParams({ q, sort: 'updated', order: 'asc', per_page: '100', page: '1' })}`,
      ),
    );
    if (first.total_count > 1000 || first.incomplete_results) {
      if (to.getTime() - from.getTime() <= 2000)
        throw new Error(
          'GitHub search window is saturated; narrow discovery queries. Cursor was not advanced.',
        );
      const mid = new Date(Math.floor((from.getTime() + to.getTime()) / 2000) * 1000);
      yield* this.searchIssues(language, label, from, mid);
      yield* this.searchIssues(language, label, mid, to);
      return;
    }
    for (const raw of first.items) {
      const item = discoveredIssue(raw);
      if (item) yield item;
    }
    for (let page = 2; page <= Math.ceil(first.total_count / 100); page++) {
      const result = schema.parse(
        await this.request(
          `/search/issues?${new URLSearchParams({ q, sort: 'updated', order: 'asc', per_page: '100', page: String(page) })}`,
        ),
      );
      if (result.incomplete_results)
        throw new Error('Incomplete GitHub search; cursor was not advanced.');
      for (const raw of result.items) {
        const item = discoveredIssue(raw);
        if (item) yield item;
      }
    }
  }
  async *searchRepositories(language: string) {
    // Bounded repository discovery; issue discovery independently partitions the complete configured date window.
    const q = `archived:false is:public language:"${language}" pushed:>${new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)}`;
    for (let page = 1; page <= 3; page++) {
      const result = z
        .object({ items: z.array(repositorySchema), incomplete_results: z.boolean() })
        .parse(
          await this.request(
            `/search/repositories?${new URLSearchParams({ q, sort: 'updated', per_page: '100', page: String(page) })}`,
          ),
        );
      if (result.incomplete_results) throw new Error('Incomplete repository search.');
      for (const raw of result.items)
        yield normalizeRepository(raw, raw.language ? [raw.language] : []);
      if (result.items.length < 100) break;
    }
  }
  async repository(owner: string, name: string) {
    const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
    const raw = repositorySchema.parse(await this.request(path));
    const languages = z
      .record(z.string(), z.number())
      .parse(await this.request(`${path}/languages`));
    let contributionUrl: string | null = null;
    try {
      const community = z
        .object({
          files: z.object({
            contributing: z.object({ html_url: githubUrl }).nullable().optional(),
          }),
        })
        .parse(await this.request(`${path}/community/profile`));
      contributionUrl = community.files.contributing?.html_url || null;
    } catch (error) {
      if (!(error instanceof SourceError && error.status === 404)) throw error;
    }
    return normalizeRepository(raw, Object.keys(languages), contributionUrl);
  }
  async issue(owner: string, name: string, number: number) {
    return normalizeIssue(
      await this.request(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${number}`,
      ),
    );
  }
}

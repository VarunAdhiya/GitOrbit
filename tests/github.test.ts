import { describe, expect, it, vi } from 'vitest';
import {
  GitHubProvider,
  normalizeIssue,
  normalizeRepository,
  RateLimitError,
  retryDelay,
} from '../apps/worker/src/providers/github.ts';
import { rawIssue, rawRepository } from './fixtures.ts';
describe('GitHub normalization', () => {
  it('keeps source timestamps distinct and does not assume required language', () => {
    const repo = normalizeRepository(rawRepository, ['TypeScript']);
    const issue = normalizeIssue({ ...rawIssue, body: 'Fix spacing', title: 'Improve layout' });
    expect(repo.createdAtSource).not.toEqual(repo.lastPushedAt);
    expect(issue?.createdAtSource).not.toEqual(issue?.updatedAtSource);
    expect(issue?.relevantSkills).toEqual([]);
  });
  it('excludes pull requests', () =>
    expect(normalizeIssue({ ...rawIssue, pull_request: { url: 'anything' } })).toBeNull());
  it('preserves closure and assignment', () =>
    expect(
      normalizeIssue({ ...rawIssue, state: 'closed', assignees: [{ login: 'dev' }] }),
    ).toMatchObject({ state: 'closed', assigned: true }));
  it('rejects malicious source URLs', () =>
    expect(() =>
      normalizeIssue({ ...rawIssue, html_url: 'https://evil.example/issue' }),
    ).toThrow());
  it('keeps reliable external IDs for duplicate writes', () =>
    expect(normalizeIssue(rawIssue)?.externalId).toBe(
      normalizeIssue({ ...rawIssue, title: 'Updated title' })?.externalId,
    ));
  it('honors retry-after and primary reset', () => {
    expect(retryDelay(new Headers({ 'retry-after': '120' }))).toBe(120000);
    expect(
      retryDelay(new Headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '500' }), 100000),
    ).toBe(401000);
  });
  it('turns secondary throttling into a delayed retry', async () => {
    const provider = new GitHubProvider(
      'test',
      vi
        .fn()
        .mockResolvedValue(new Response('', { status: 429, headers: { 'retry-after': '180' } })),
    );
    await expect(provider.request('/search/issues')).rejects.toBeInstanceOf(RateLimitError);
  });
  it('paginates issue search and excludes PRs', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ total_count: 101, incomplete_results: false, items: [rawIssue] }),
      )
      .mockResolvedValueOnce(
        Response.json({
          total_count: 101,
          incomplete_results: false,
          items: [{ ...rawIssue, id: 2002, pull_request: {} }],
        }),
      );
    const items = [];
    for await (const i of new GitHubProvider('test', fetcher).searchIssues(
      'TypeScript',
      'good first issue',
      new Date('2026-01-01'),
      new Date('2026-02-01'),
    ))
      items.push(i);
    expect(items).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[1][0])).toContain('page=2');
  });
  it('partitions queries that exceed GitHub search limits', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ total_count: 1001, incomplete_results: false, items: [] }),
      )
      .mockImplementation(async () =>
        Response.json({ total_count: 1, incomplete_results: false, items: [rawIssue] }),
      );
    const items = [];
    for await (const i of new GitHubProvider('test', fetcher).searchIssues(
      'TypeScript',
      'help wanted',
      new Date('2026-01-01'),
      new Date('2026-02-01'),
    ))
      items.push(i);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(items).toHaveLength(2);
  });
});

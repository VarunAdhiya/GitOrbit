import { describe, expect, it } from 'vitest';
import {
  containsTerm,
  detectSkills,
  filtersSchema,
  inferDifficulty,
  normalizeSkill,
  normalizeSkills,
  profileInputSchema,
} from '@gitorbit/shared';
import { profile } from './fixtures.ts';
describe('skill normalization', () => {
  it('recognizes short technical names without confusing the verb go', () => {
    expect(detectSkills('Go, JS, TS and C# bindings')).toEqual(
      expect.arrayContaining(['Go', 'JavaScript', 'TypeScript', 'C#']),
    );
    expect(detectSkills('Please go to the settings page')).not.toContain('Go');
  });
  it.each([
    ['JS', 'JavaScript'],
    ['  golang  ', 'Go'],
    ['react.js', 'React'],
    ['postgres', 'PostgreSQL'],
    ['C++', 'C++'],
  ])('normalizes %s', (input, expected) => expect(normalizeSkill(input)).toBe(expected));
  it('deduplicates aliases', () =>
    expect(
      normalizeSkills([
        { ...profile.skills[0], name: 'JS' },
        { ...profile.skills[0], name: 'javascript' },
      ]),
    ).toHaveLength(1));
  it('matches whole technical terms without substrings', () => {
    expect(containsTerm('C++ support', 'C++')).toBe(true);
    expect(containsTerm('Django and governance', 'Go')).toBe(false);
    expect(detectSkills('Django and React.js')).toEqual(
      expect.arrayContaining(['Django', 'React']),
    );
  });
});
describe('input bounds and honest difficulty', () => {
  it('does not equate help wanted to beginner', () =>
    expect(inferDifficulty(['help wanted']).difficulty).toBe('unknown'));
  it('uses a maintainer difficulty label', () =>
    expect(inferDifficulty(['good first issue']).difficulty).toBe('beginner'));
  it.each([
    { page: 0 },
    { limit: 10000 },
    { page: 'NaN' },
    { q: 'x'.repeat(161) },
    { sort: 'anything' },
    { program: 'gsoc' },
  ])('rejects invalid filter %j', (value) =>
    expect(filtersSchema.safeParse(value).success).toBe(false),
  );
  it('bounds pagination defaults', () =>
    expect(filtersSchema.parse({})).toMatchObject({ page: 1, limit: 12 }));
  it('rejects unbounded skill lists and unknown fields', () => {
    expect(
      profileInputSchema.safeParse({ ...profile, skills: Array(81).fill(profile.skills[0]) })
        .success,
    ).toBe(false);
    expect(profileInputSchema.safeParse({ ...profile, session: 'forged' }).success).toBe(false);
  });
});

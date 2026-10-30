import { describe, expect, it } from 'vitest';
import { rankOpportunity, WEIGHTS } from '@gitorbit/matching';
import { opportunity, profile } from './fixtures.ts';
describe('transparent recommendation ranking', () => {
  it('uses the required weights and normalized scores', () => {
    expect(WEIGHTS).toEqual({ skill: 0.4, difficulty: 0.25, activity: 0.2, interest: 0.15 });
    expect(rankOpportunity(opportunity, profile).score).toBe(100);
  });
  it('distinguishes repository context from issue requirements', () => {
    const result = rankOpportunity({ ...opportunity, relevantSkills: [] }, profile);
    expect(result.skillScore).toBe(45);
    expect(result.matchingSkills).toEqual([]);
    expect(result.explanation).toContain('requirements still need review');
  });
  it('reports missing or uncertain prerequisites', () => {
    const result = rankOpportunity({ ...opportunity, relevantSkills: ['Rust'] }, profile);
    expect(result.skillScore).toBe(0);
    expect(result.uncertainPrerequisites).toContain('Rust');
  });
  it.each(['Git', 'git', ' GIT '])(
    'ignores %s in scores, match reasons and missing prerequisites',
    (name) => {
      const now = new Date();
      const baseline = rankOpportunity(opportunity, profile, now);
      const withGit = { ...opportunity, relevantSkills: [...opportunity.relevantSkills, name] };
      expect(rankOpportunity(withGit, profile, now)).toEqual(baseline);
      expect(
        rankOpportunity(
          withGit,
          {
            ...profile,
            skills: [...profile.skills, { name, category: 'tools', confidence: 1, source: 'user' }],
          },
          now,
        ),
      ).toEqual(baseline);
    },
  );
  it('does not give a Git-only profile a skill match', () => {
    const result = rankOpportunity(
      {
        ...opportunity,
        relevantSkills: ['Git'],
        repository: { ...opportunity.repository, languages: [] },
      },
      { ...profile, skills: [{ name: 'Git', category: 'tools', confidence: 1, source: 'user' }] },
    );
    expect(result.skillScore).toBe(0);
    expect(result.matchingSkills).toEqual([]);
    expect(result.explanation).toContain('No confirmed skill overlap');
    expect(result.uncertainPrerequisites).not.toContain('Git');
  });
  it('still uses genuine repository language context when only Git is mentioned in the issue', () => {
    const result = rankOpportunity({ ...opportunity, relevantSkills: ['Git'] }, profile);
    expect(result.skillScore).toBe(45);
    expect(result.matchingSkills).toEqual([]);
    expect(result.explanation).toContain('TypeScript');
    expect(result.explanation).not.toContain('Git');
  });
  it('does not invent difficulty', () =>
    expect(
      rankOpportunity({ ...opportunity, difficulty: 'unknown' }, profile).difficultyScore,
    ).toBe(50));
  it('uses recent issue activity despite an old last push', () =>
    expect(
      rankOpportunity(
        {
          ...opportunity,
          repository: { ...opportunity.repository, lastPushedAt: '2020-01-01T00:00:00Z' },
        },
        profile,
      ).activityScore,
    ).toBe(100));
  it('does not punish quiet repositories with zero activity', () => {
    const result = rankOpportunity(
      {
        ...opportunity,
        updatedAtSource: '2020-01-01T00:00:00Z',
        repository: { ...opportunity.repository, lastPushedAt: null },
      },
      profile,
    );
    expect(result.activityScore).toBe(55);
  });
  it('assigns zero activity to archived repositories', () =>
    expect(
      rankOpportunity(
        { ...opportunity, repository: { ...opportunity.repository, archived: true } },
        profile,
      ).activityScore,
    ).toBe(0));
  it('is deterministic and keeps all subscores within bounds', () => {
    const a = rankOpportunity(opportunity, { ...profile, skills: [], interests: [] });
    expect(rankOpportunity(opportunity, { ...profile, skills: [], interests: [] })).toEqual(a);
    for (const n of [a.score, a.skillScore, a.difficultyScore, a.activityScore, a.interestScore]) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(100);
    }
  });
});

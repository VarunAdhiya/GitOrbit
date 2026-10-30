import {
  containsTerm,
  skillKey,
  type Match,
  type Opportunity,
  type ProfileInput,
} from '@gitorbit/shared';
export const WEIGHTS = { skill: 0.4, difficulty: 0.25, activity: 0.2, interest: 0.15 } as const;
export function rankOpportunity(
  issue: Opportunity,
  profile: ProfileInput,
  now = new Date(),
): Match {
  // Git is baseline contribution tooling, not a signal of issue-specific fit.
  const profileKeys = new Set(
    profile.skills.map((s) => skillKey(s.name)).filter((s) => s !== 'git'),
  );
  const relevantSkills = issue.relevantSkills.filter((s) => skillKey(s) !== 'git');
  const explicit = relevantSkills.filter((s) => profileKeys.has(skillKey(s)));
  const context = issue.repository.languages.filter(
    (s) => profileKeys.has(skillKey(s)) && !explicit.some((x) => skillKey(x) === skillKey(s)),
  );
  const requiredCount = relevantSkills.length;
  const skillScore = requiredCount
    ? Math.round((100 * explicit.length) / requiredCount)
    : context.length
      ? 45
      : 0;
  const desired =
    profile.desiredDifficulty === 'any' ? profile.experienceLevel : profile.desiredDifficulty;
  const levels = ['beginner', 'intermediate', 'advanced'];
  const difficultyScore =
    issue.difficulty === 'unknown' || desired === 'unknown'
      ? 50
      : issue.difficulty === desired
        ? 100
        : Math.max(
            20,
            100 - Math.abs(levels.indexOf(issue.difficulty) - levels.indexOf(desired)) * 40,
          );
  const pushAge = issue.repository.lastPushedAt
    ? (now.getTime() - new Date(issue.repository.lastPushedAt).getTime()) / 86400000
    : Infinity;
  const issueAge = (now.getTime() - new Date(issue.updatedAtSource).getTime()) / 86400000;
  const activityScore = issue.repository.archived
    ? 0
    : pushAge <= 30 || issueAge <= 14
      ? 100
      : pushAge <= 90 || issueAge <= 60
        ? 80
        : 55;
  const haystack = `${issue.repository.topics.join(' ').replaceAll('-', ' ')} ${issue.repository.description || ''} ${issue.title} ${issue.description}`;
  const interests = profile.interests.filter((s) => containsTerm(haystack, s));
  const interestScore = profile.interests.length
    ? Math.round((100 * interests.length) / profile.interests.length)
    : 50;
  const score = Math.round(
    skillScore * WEIGHTS.skill +
      difficultyScore * WEIGHTS.difficulty +
      activityScore * WEIGHTS.activity +
      interestScore * WEIGHTS.interest,
  );
  const uncertainPrerequisites = relevantSkills.filter((s) => !profileKeys.has(skillKey(s)));
  if (!requiredCount)
    uncertainPrerequisites.push('Issue-specific technical requirements are not confirmed.');
  const explanation = explicit.length
    ? `${explicit.join(', ')} ${explicit.length === 1 ? 'is' : 'are'} mentioned in the issue and in your profile.`
    : context.length
      ? `Your ${context.join(', ')} skills overlap with repository languages; the issue requirements still need review.`
      : 'No confirmed skill overlap yet. Review the issue before choosing it.';
  return {
    score,
    skillScore,
    difficultyScore,
    activityScore,
    interestScore,
    matchingSkills: explicit,
    uncertainPrerequisites,
    explanation,
    activitySummary:
      activityScore === 100
        ? 'Recent repository or issue activity'
        : activityScore === 80
          ? 'Activity within the last quarter'
          : 'Limited recent signals; maintainer responsiveness unknown',
  };
}

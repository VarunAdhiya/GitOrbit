import { Prisma, type PrismaClient } from '@gitorbit/database';
import {
  opportunityResponseSchema,
  validateResponse,
  type Filters,
  type Opportunity,
  type ProfileInput,
} from '@gitorbit/shared';
import { rankOpportunity } from '@gitorbit/matching';
export function opportunityWhere(
  filters: Filters,
  staleHours: number,
  now = new Date(),
): Prisma.IssueWhereInput {
  const and: Prisma.IssueWhereInput[] = [
    {
      state: 'open',
      stale: false,
      lastSyncedAt: { gte: new Date(now.getTime() - staleHours * 3600000) },
      repository: { archived: false },
    },
  ];
  if (filters.q)
    and.push({
      OR: [
        { title: { contains: filters.q, mode: 'insensitive' } },
        { description: { contains: filters.q, mode: 'insensitive' } },
        { repository: { name: { contains: filters.q, mode: 'insensitive' } } },
      ],
    });
  if (filters.language)
    and.push({
      repository: { primaryLanguage: { equals: filters.language, mode: 'insensitive' } },
    });
  if (filters.skill) and.push({ relevantSkills: { has: filters.skill } });
  if (filters.difficulty !== 'any') and.push({ difficulty: filters.difficulty });
  if (filters.activity !== 'any')
    and.push({
      repository: {
        lastPushedAt: {
          gte: new Date(now.getTime() - (filters.activity === 'month' ? 30 : 90) * 86400000),
        },
      },
    });
  if (filters.repository.includes('/')) {
    const [owner, name] = filters.repository.split('/');
    and.push({
      repository: {
        owner: { equals: owner, mode: 'insensitive' },
        name: { equals: name, mode: 'insensitive' },
      },
    });
  } else if (filters.repository)
    and.push({
      OR: [
        { repository: { name: { contains: filters.repository, mode: 'insensitive' } } },
        { repository: { owner: { contains: filters.repository, mode: 'insensitive' } } },
      ],
    });
  if (filters.program)
    and.push({
      programs: { some: { programId: filters.program, program: { verifiedAt: { not: null } } } },
    });
  if (filters.available === 'true') and.push({ assigned: false, inProgress: false });
  return { AND: and };
}
type Row = Prisma.IssueGetPayload<{ include: { repository: true } }>;
export function serializeOpportunity(row: Row): Opportunity {
  return validateResponse(opportunityResponseSchema, {
    ...row,
    createdAtSource: row.createdAtSource.toISOString(),
    updatedAtSource: row.updatedAtSource.toISOString(),
    lastSyncedAt: row.lastSyncedAt.toISOString(),
    repository: {
      ...row.repository,
      lastPushedAt: row.repository.lastPushedAt?.toISOString() || null,
      lastSyncedAt: row.repository.lastSyncedAt.toISOString(),
      createdAtSource: row.repository.createdAtSource.toISOString(),
    },
  });
}
export async function listOpportunities(
  db: PrismaClient,
  filters: Filters,
  staleHours: number,
  profile?: ProfileInput,
) {
  const where = opportunityWhere(filters, staleHours);
  if (profile?.preferredLanguages.length && !filters.language) {
    (where.AND as Prisma.IssueWhereInput[]).push({
      repository: { languages: { hasSome: profile.preferredLanguages } },
    });
  }
  const total = await db.issue.count({ where });
  const orderBy: Prisma.IssueOrderByWithRelationInput[] = [
    ...(filters.sort === 'stars' || filters.sort === 'forks'
      ? [{ repository: { [filters.sort]: 'desc' as const } }]
      : []),
    { [filters.sort === 'created' ? 'createdAtSource' : 'updatedAtSource']: 'desc' },
    { id: 'asc' },
  ];
  if (profile && filters.sort === 'match') {
    // Explicitly bounded MVP ranking window, exposed in the response and UI.
    const rows = await db.issue.findMany({
      where,
      include: { repository: true },
      orderBy,
      take: 1000,
    });
    const ranked = rows
      .map(serializeOpportunity)
      .map((item) => ({ ...item, match: rankOpportunity(item, profile) }))
      .sort(
        (a, b) =>
          b.match.score - a.match.score ||
          Date.parse(b.updatedAtSource) - Date.parse(a.updatedAtSource) ||
          a.id.localeCompare(b.id),
      );
    return {
      items: ranked.slice((filters.page - 1) * filters.limit, filters.page * filters.limit),
      total,
      page: filters.page,
      limit: filters.limit,
      pages: Math.ceil(ranked.length / filters.limit),
      rankedCandidates: ranked.length,
      rankingLimited: total > ranked.length,
    };
  }
  const rows = await db.issue.findMany({
    where,
    include: { repository: true },
    orderBy,
    take: filters.limit,
    skip: (filters.page - 1) * filters.limit,
  });
  return {
    items: rows
      .map(serializeOpportunity)
      .map((item) => (profile ? { ...item, match: rankOpportunity(item, profile) } : item)),
    total,
    page: filters.page,
    limit: filters.limit,
    pages: Math.ceil(total / filters.limit),
  };
}

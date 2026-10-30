import { createHash, randomBytes } from 'node:crypto';
import type { PrismaClient } from '@gitorbit/database';
import {
  normalizeSkills,
  skillKey,
  profileResponseSchema,
  validateResponse,
  type ProfileInput,
  type Profile,
} from '@gitorbit/shared';
import { ApiError } from './errors.ts';
export const COOKIE_NAME = 'gitorbit_session';
export function sessionHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
const include = { skills: { include: { skill: true } } } as const;
export async function getProfile(
  db: PrismaClient,
  token: string | undefined,
  id?: string,
  authUserId?: string,
) {
  if (!authUserId && (!token || !/^[a-f0-9]{64}$/.test(token)))
    throw new ApiError(
      401,
      'PROFILE_REQUIRED',
      'Create or upload a profile to get personalized matches.',
    );
  const profile = await db.userProfile.findFirst({
    where: {
      ...(authUserId
        ? { authUserId }
        : {
            anonymousSessionId: sessionHash(token!),
            authUserId: null,
            expiresAt: { gt: new Date() },
          }),
      ...(id ? { id } : {}),
    },
    include,
  });
  if (!profile)
    throw new ApiError(
      404,
      'PROFILE_NOT_FOUND',
      'This profile is unavailable or has expired. Start a new profile.',
    );
  return profile;
}
type StoredProfile = Awaited<ReturnType<typeof getProfile>>;
export function serializeProfile(profile: StoredProfile): Profile {
  return validateResponse(profileResponseSchema, {
    id: profile.id,
    experienceLevel: profile.experienceLevel as Profile['experienceLevel'],
    experienceInferred: profile.experienceInferred,
    experienceSummary: profile.experienceSummary,
    interests: profile.interests,
    preferredLanguages: profile.preferredLanguages,
    desiredDifficulty: profile.desiredDifficulty as Profile['desiredDifficulty'],
    expiresAt: profile.expiresAt?.toISOString() || null,
    skills: profile.skills.map((s) => ({
      name: s.skill.name,
      category: s.skill.category as Profile['skills'][number]['category'],
      confidence: s.confidence,
      source: s.source as 'extracted' | 'user',
    })),
  });
}
export async function saveProfile(
  db: PrismaClient,
  input: ProfileInput,
  options: {
    token?: string;
    authUserId?: string;
    id?: string;
    ttlHours: number;
    inferred?: boolean;
    experienceSummary?: string[];
  },
) {
  const old = options.id
    ? await getProfile(db, options.token, options.id, options.authUserId)
    : null;
  const token = options.authUserId ? null : old ? options.token! : randomBytes(32).toString('hex');
  const skills = normalizeSkills(input.skills);
  const profile = await db.$transaction(
    async (tx) => {
      // A successful replacement revokes the previous anonymous session atomically.
      if (!old && options.token && !options.authUserId)
        await tx.userProfile.deleteMany({
          where: { anonymousSessionId: sessionHash(options.token), authUserId: null },
        });
      const fields = {
        experienceLevel: input.experienceLevel,
        experienceInferred: options.inferred ?? false,
        interests: input.interests,
        preferredLanguages: input.preferredLanguages,
        desiredDifficulty: input.desiredDifficulty,
        ...(options.experienceSummary ? { experienceSummary: options.experienceSummary } : {}),
      };
      const record = options.authUserId
        ? await tx.userProfile.upsert({
            where: { authUserId: options.authUserId },
            create: {
              ...fields,
              authUserId: options.authUserId,
              anonymousSessionId: null,
              expiresAt: null,
            },
            update: fields,
          })
        : old
          ? await tx.userProfile.update({ where: { id: old.id }, data: fields })
          : await tx.userProfile.create({
              data: {
                ...fields,
                anonymousSessionId: sessionHash(token!),
                expiresAt: new Date(Date.now() + options.ttlHours * 3600000),
              },
            });
      await tx.profileSkill.deleteMany({ where: { profileId: record.id } });
      if (skills.length) {
        // Batch vocabulary and profile links to avoid two remote round trips per skill.
        await tx.skill.createMany({
          data: skills
            .map((skill) => ({
              name: skill.name,
              normalizedName: skillKey(skill.name),
              category: skill.category,
            }))
            .sort((a, b) => a.normalizedName.localeCompare(b.normalizedName)),
          skipDuplicates: true,
        });
        const rows = await tx.skill.findMany({
          where: { normalizedName: { in: skills.map((skill) => skillKey(skill.name)) } },
          select: { id: true, normalizedName: true },
        });
        const ids = new Map(rows.map((row) => [row.normalizedName, row.id]));
        await tx.profileSkill.createMany({
          data: skills.map((skill) => {
            const skillId = ids.get(skillKey(skill.name));
            if (!skillId) throw new Error('Saved skill could not be resolved');
            return {
              profileId: record.id,
              skillId,
              confidence: skill.source === 'user' ? 1 : skill.confidence,
              source: skill.source,
            };
          }),
        });
      }
      return tx.userProfile.findUniqueOrThrow({ where: { id: record.id }, include });
    },
    { timeout: 15000 },
  );
  return { profile: serializeProfile(profile), token };
}

export async function claimGuestProfile(
  db: PrismaClient,
  token: string | undefined,
  authUserId: string,
) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return;
  if (await db.userProfile.findUnique({ where: { authUserId }, select: { id: true } })) return;
  // The update is conditional so an expired or already claimed guest profile cannot transfer.
  try {
    await db.userProfile.updateMany({
      where: {
        anonymousSessionId: sessionHash(token),
        authUserId: null,
        expiresAt: { gt: new Date() },
      },
      data: { authUserId, anonymousSessionId: null, expiresAt: null },
    });
  } catch (error) {
    // Another sign-in may have created this account's profile concurrently.
    if (!(error instanceof Error && 'code' in error && error.code === 'P2002')) throw error;
  }
}

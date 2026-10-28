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
export async function getProfile(db: PrismaClient, token: string | undefined, id?: string) {
  if (!token || !/^[a-f0-9]{64}$/.test(token))
    throw new ApiError(
      401,
      'PROFILE_REQUIRED',
      'Create or upload a profile to get personalized matches.',
    );
  const profile = await db.userProfile.findFirst({
    where: {
      anonymousSessionId: sessionHash(token),
      expiresAt: { gt: new Date() },
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
    expiresAt: profile.expiresAt.toISOString(),
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
    id?: string;
    ttlHours: number;
    inferred?: boolean;
    experienceSummary?: string[];
  },
) {
  const old = options.id ? await getProfile(db, options.token, options.id) : null;
  const token = old ? options.token! : randomBytes(32).toString('hex');
  const profile = await db.$transaction(
    async (tx) => {
      // A successful replacement revokes the previous anonymous session atomically.
      if (!old && options.token)
        await tx.userProfile.deleteMany({
          where: { anonymousSessionId: sessionHash(options.token) },
        });
      const fields = {
        experienceLevel: input.experienceLevel,
        experienceInferred: options.inferred ?? false,
        interests: input.interests,
        preferredLanguages: input.preferredLanguages,
        desiredDifficulty: input.desiredDifficulty,
        ...(options.experienceSummary ? { experienceSummary: options.experienceSummary } : {}),
      };
      const record = old
        ? await tx.userProfile.update({ where: { id: old.id }, data: fields })
        : await tx.userProfile.create({
            data: {
              ...fields,
              anonymousSessionId: sessionHash(token),
              expiresAt: new Date(Date.now() + options.ttlHours * 3600000),
            },
          });
      await tx.profileSkill.deleteMany({ where: { profileId: record.id } });
      for (const skill of normalizeSkills(input.skills)) {
        const row = await tx.skill.upsert({
          where: { normalizedName: skillKey(skill.name) },
          create: {
            name: skill.name,
            normalizedName: skillKey(skill.name),
            category: skill.category,
          },
          update: {},
        });
        await tx.profileSkill.create({
          data: {
            profileId: record.id,
            skillId: row.id,
            confidence: skill.source === 'user' ? 1 : skill.confidence,
            source: skill.source,
          },
        });
      }
      return tx.userProfile.findUniqueOrThrow({ where: { id: record.id }, include });
    },
    { timeout: 15000 },
  );
  return { profile: serializeProfile(profile), token };
}

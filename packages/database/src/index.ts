import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/client.ts';
export { Prisma } from '../generated/client.ts';
export type { PrismaClient, Issue, Repository, UserProfile } from '../generated/client.ts';
export function createDatabase(url: string) {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: url,
      max: 8,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
    }),
  });
}

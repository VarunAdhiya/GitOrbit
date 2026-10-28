import type { Prisma } from '@gitorbit/database';

export type RepositoryRecord = Omit<
  Prisma.RepositoryCreateManyInput,
  'id' | 'createdAt' | 'updatedAt'
> & {
  languages: string[];
  topics: string[];
  lastSyncedAt: Date;
};
export type IssueRecord = Omit<Prisma.IssueCreateManyInput, 'id' | 'repositoryId'> & {
  updatedAtSource: Date;
  lastSyncedAt: Date;
};
export type DiscoveredIssue = { issue: IssueRecord; repository: { owner: string; name: string } };

/** Source adapters own API shapes and URLs; ingestion only consumes normalized records. */
export interface OpportunityProvider {
  source: string;
  searchIssues(
    language: string,
    label: string,
    from: Date,
    to: Date,
  ): AsyncGenerator<DiscoveredIssue>;
  searchRepositories(language: string): AsyncGenerator<RepositoryRecord>;
  repository(owner: string, name: string): Promise<RepositoryRecord>;
  issue(owner: string, name: string, number: number): Promise<IssueRecord | null>;
}

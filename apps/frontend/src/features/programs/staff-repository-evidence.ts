import { apiClient } from '@/lib/api-client';

export interface RepositoryContributor {
  readonly githubId: string;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly releaseCount: number;
}
export interface RepositoryContributions {
  readonly repositoryId: string;
  readonly repositoryUrl: string;
  readonly window: {
    readonly from: string;
    readonly to: string;
    readonly timeZone: 'Asia/Seoul';
  };
  readonly collectionStatus: 'NOT_COLLECTED' | 'COLLECTED' | 'ERROR';
  readonly lastSuccessAt: string | null;
  readonly members: readonly (RepositoryContributor & {
    readonly userId: string;
    readonly hasObservations: boolean;
  })[];
  readonly unmatchedContributors: readonly RepositoryContributor[];
}
export interface RepositoryHistoryItem {
  readonly id: string;
  readonly occurredAt: string;
  readonly actorGithubLogin: string;
  readonly previousRepositoryUrl: string | null;
  readonly newRepositoryUrl: string;
  readonly reason: string;
}
export interface RepositoryHistoryPage {
  readonly items: readonly RepositoryHistoryItem[];
  readonly nextCursor: string | null;
}
export interface StaffRepositoryEvidence {
  readonly repositoryContributions: RepositoryContributions | null;
  readonly repositoryUrlHistory: RepositoryHistoryPage;
}
export class StaffRepositoryResponseError extends Error {
  constructor() {
    super('저장소 활동 응답 형식을 확인할 수 없습니다.');
    this.name = 'StaffRepositoryResponseError';
  }
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}
function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
function repositoryUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(value)
  );
}
function date(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^(?:\d{4}|[+-]\d{6})-\d{2}-\d{2}(?:T.*)?$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
function contributor(value: unknown): value is RepositoryContributor {
  return (
    record(value) &&
    typeof value.githubId === 'string' &&
    count(value.commitCount) &&
    count(value.pullRequestCount) &&
    count(value.releaseCount)
  );
}
function historyItem(value: unknown): value is RepositoryHistoryItem {
  return (
    record(value) &&
    typeof value.id === 'string' &&
    date(value.occurredAt) &&
    typeof value.actorGithubLogin === 'string' &&
    (value.previousRepositoryUrl === null ||
      repositoryUrl(value.previousRepositoryUrl)) &&
    repositoryUrl(value.newRepositoryUrl) &&
    typeof value.reason === 'string'
  );
}
export function parseRepositoryHistory(value: unknown): RepositoryHistoryPage {
  if (
    !record(value) ||
    !Array.isArray(value.items) ||
    !value.items.every(historyItem) ||
    !nullableString(value.nextCursor)
  )
    throw new StaffRepositoryResponseError();
  return { items: value.items, nextCursor: value.nextCursor };
}
function contributions(value: unknown): value is RepositoryContributions {
  if (!record(value) || !record(value.window)) return false;
  return (
    typeof value.repositoryId === 'string' &&
    repositoryUrl(value.repositoryUrl) &&
    date(value.window.from) &&
    date(value.window.to) &&
    value.window.timeZone === 'Asia/Seoul' &&
    (value.collectionStatus === 'NOT_COLLECTED' ||
      value.collectionStatus === 'COLLECTED' ||
      value.collectionStatus === 'ERROR') &&
    (value.lastSuccessAt === null || date(value.lastSuccessAt)) &&
    Array.isArray(value.members) &&
    value.members.every(
      (member: unknown) =>
        record(member) &&
        contributor(member) &&
        typeof member.userId === 'string' &&
        typeof member.hasObservations === 'boolean',
    ) &&
    Array.isArray(value.unmatchedContributors) &&
    value.unmatchedContributors.every(contributor)
  );
}
export function parseStaffRepositoryEvidence(
  value: unknown,
): StaffRepositoryEvidence {
  if (
    !record(value) ||
    (value.repositoryContributions !== null &&
      !contributions(value.repositoryContributions))
  )
    throw new StaffRepositoryResponseError();
  return {
    repositoryContributions: value.repositoryContributions,
    repositoryUrlHistory: parseRepositoryHistory(value.repositoryUrlHistory),
  };
}
export async function getRepositoryHistory(
  programId: string,
  teamId: string,
  cursor: string,
): Promise<RepositoryHistoryPage> {
  return parseRepositoryHistory(
    await apiClient<unknown>(
      `programs/${encodeURIComponent(programId)}/teams/${encodeURIComponent(teamId)}/repository-url-history?cursor=${encodeURIComponent(cursor)}`,
    ),
  );
}

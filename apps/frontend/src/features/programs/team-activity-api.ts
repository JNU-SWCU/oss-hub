import { apiClient } from '@/lib/api-client';
import { isHttpsGithubOwnerRepoUrl } from './repository-url-api';

export const TEAM_ACTIVITY_METRICS = [
  'commitCount',
  'pullRequestCount',
  'issueCount',
] as const;
export type TeamActivityMetric = (typeof TEAM_ACTIVITY_METRICS)[number];
export type TeamActivityCounts = Readonly<Record<TeamActivityMetric, number>>;

interface TeamActivityPoint extends TeamActivityCounts {
  readonly date: string;
}

export interface TeamActivityMember {
  readonly userId: string;
  readonly githubLogin: string;

  readonly totals: TeamActivityCounts;
  readonly points: readonly TeamActivityPoint[];
}

type TeamActivityStatus =
  'NOT_CONNECTED' | 'NOT_COLLECTED' | 'COLLECTED' | 'ERROR';

export interface TeamActivity {
  readonly applicationId: string | null;
  readonly repository: { readonly id: string; readonly url: string } | null;
  readonly status: TeamActivityStatus;
  readonly lastSuccessAt: string | null;

  readonly window: {
    readonly from: string;
    readonly to: string;
    readonly timeZone: 'Asia/Seoul';
  };
  readonly canEditRepositoryUrl: boolean;
  readonly members: readonly TeamActivityMember[];
}

interface RepositoryHistoryItem {
  readonly id: string;
  readonly occurredAt: string;
  readonly actorGithubLogin: string;
  readonly previousRepositoryUrl: string | null;
  readonly newRepositoryUrl: string;
}
export interface RepositoryHistoryPage {
  readonly items: readonly RepositoryHistoryItem[];
  readonly nextCursor: string | null;
}

export class TeamActivityResponseError extends Error {
  constructor() {
    super('저장소 활동 응답 형식을 확인할 수 없습니다.');
    this.name = 'TeamActivityResponseError';
  }
}

const STATUSES: readonly unknown[] = [
  'NOT_CONNECTED',
  'NOT_COLLECTED',
  'COLLECTED',
  'ERROR',
] satisfies readonly TeamActivityStatus[];

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function date(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^(?:\d{4}|[+-]\d{6})-\d{2}-\d{2}(?:T.*)?$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function calendarDay(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    new Date(`${value}T00:00:00Z`).toISOString().startsWith(value)
  );
}
function counts(value: unknown): value is TeamActivityCounts {
  return (
    record(value) &&
    TEAM_ACTIVITY_METRICS.every((metric) => count(value[metric]))
  );
}
function member(value: unknown): value is TeamActivityMember {
  return (
    record(value) &&
    typeof value.userId === 'string' &&
    typeof value.githubLogin === 'string' &&
    counts(value.totals) &&
    Array.isArray(value.points) &&
    value.points.every(
      (point: unknown) =>
        record(point) && calendarDay(point.date) && counts(point),
    )
  );
}

function teamActivity(value: unknown): value is TeamActivity {
  return (
    record(value) &&
    record(value.window) &&
    (value.applicationId === null || typeof value.applicationId === 'string') &&
    (value.repository === null ||
      (record(value.repository) &&
        typeof value.repository.id === 'string' &&
        isHttpsGithubOwnerRepoUrl(value.repository.url))) &&
    STATUSES.includes(value.status) &&
    (value.status === 'NOT_CONNECTED') === (value.repository === null) &&
    (value.lastSuccessAt === null || date(value.lastSuccessAt)) &&
    date(value.window.from) &&
    date(value.window.to) &&
    value.window.timeZone === 'Asia/Seoul' &&
    typeof value.canEditRepositoryUrl === 'boolean' &&
    Array.isArray(value.members) &&
    value.members.every(member) &&
    new Set(value.members.map((item) => item.userId)).size ===
      value.members.length
  );
}

export function parseTeamActivity(value: unknown): TeamActivity {
  if (!teamActivity(value)) throw new TeamActivityResponseError();
  return value;
}

function historyItem(value: unknown): value is RepositoryHistoryItem {
  return (
    record(value) &&
    typeof value.id === 'string' &&
    date(value.occurredAt) &&
    typeof value.actorGithubLogin === 'string' &&
    (value.previousRepositoryUrl === null ||
      isHttpsGithubOwnerRepoUrl(value.previousRepositoryUrl)) &&
    isHttpsGithubOwnerRepoUrl(value.newRepositoryUrl)
  );
}

export function parseRepositoryHistory(value: unknown): RepositoryHistoryPage {
  if (
    !record(value) ||
    !Array.isArray(value.items) ||
    !value.items.every(historyItem) ||
    !(value.nextCursor === null || typeof value.nextCursor === 'string')
  )
    throw new TeamActivityResponseError();
  return { items: value.items, nextCursor: value.nextCursor };
}

function teamPath(programId: string, teamId: string): string {
  return `programs/${encodeURIComponent(programId)}/teams/${encodeURIComponent(teamId)}`;
}

export async function getTeamActivity(
  programId: string,
  teamId: string,
): Promise<TeamActivity> {
  return parseTeamActivity(
    await apiClient<unknown>(`${teamPath(programId, teamId)}/activity`),
  );
}

export async function getRepositoryHistory(
  programId: string,
  teamId: string,
  cursor?: string,
): Promise<RepositoryHistoryPage> {
  const query =
    cursor === undefined ? '' : `?cursor=${encodeURIComponent(cursor)}`;
  return parseRepositoryHistory(
    await apiClient<unknown>(
      `${teamPath(programId, teamId)}/repository-url-history${query}`,
    ),
  );
}

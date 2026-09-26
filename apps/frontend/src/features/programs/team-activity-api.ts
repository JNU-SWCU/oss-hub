import { apiClient } from '@/lib/api-client';
import { isHttpsGithubOwnerRepoUrl } from './repository-url-api';

/** 그래프가 고를 수 있는 지표. 칩 순서도 이 순서다. */
export const TEAM_ACTIVITY_METRICS = [
  'commitCount',
  'pullRequestCount',
  'issueCount',
] as const;
export type TeamActivityMetric = (typeof TEAM_ACTIVITY_METRICS)[number];
export type TeamActivityCounts = Readonly<Record<TeamActivityMetric, number>>;

export interface TeamActivityPoint extends TeamActivityCounts {
  /** 서울 달력 날짜(`YYYY-MM-DD`). 기여가 있는 날만 온다. */
  readonly date: string;
}

export interface TeamActivityMember {
  readonly userId: string;
  readonly githubLogin: string;
  /** 창(`window`) 안의 합. */
  readonly totals: TeamActivityCounts;
  readonly points: readonly TeamActivityPoint[];
}

export type TeamActivityStatus =
  'NOT_CONNECTED' | 'NOT_COLLECTED' | 'COLLECTED' | 'ERROR';

/**
 * `GET /programs/:programId/teams/:teamId/activity` — 학생(자기 팀)과 교직원이 같은
 * 조회로 같은 그래프를 본다(#1133). 역할이 가르는 것은 `canEditRepositoryUrl`뿐이다.
 */
export interface TeamActivity {
  readonly applicationId: string | null;
  readonly repository: { readonly id: string; readonly url: string } | null;
  readonly status: TeamActivityStatus;
  readonly lastSuccessAt: string | null;
  /** 프로그램 기간. 정해지지 않은 끝은 센티널(`0001-…`·`9999-…`)로 온다. */
  readonly window: {
    readonly from: string;
    readonly to: string;
    readonly timeZone: 'Asia/Seoul';
  };
  readonly canEditRepositoryUrl: boolean;
  readonly members: readonly TeamActivityMember[];
}

export interface RepositoryHistoryItem {
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
/** 순간(ISO)이나 달력 날짜. 다섯 자리 연도 센티널(`+010000-01-01`)도 받는다. */
function date(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^(?:\d{4}|[+-]\d{6})-\d{2}-\d{2}(?:T.*)?$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
/** `2026-02-30`을 3월로 넘겨 읽지 않도록 되돌려 맞춰 본다. */
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
    // 저장소가 없는데 수집을 말하거나, 있는데 미연결이라 하면 한 화면이 두 말을 한다.
    (value.status === 'NOT_CONNECTED') === (value.repository === null) &&
    (value.lastSuccessAt === null || date(value.lastSuccessAt)) &&
    date(value.window.from) &&
    date(value.window.to) &&
    value.window.timeZone === 'Asia/Seoul' &&
    typeof value.canEditRepositoryUrl === 'boolean' &&
    Array.isArray(value.members) &&
    value.members.every(member) &&
    // 팀원은 한 번씩만 — 범례·표의 줄이 사람 수와 어긋나지 않게 한다.
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

/** 첫 쪽은 커서 없이, 다음 쪽은 앞 쪽이 준 `nextCursor`로 읽는다. */
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

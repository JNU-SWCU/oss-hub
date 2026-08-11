import { apiClient } from '@/lib/api-client';
import type {
  ActivityGranularity,
  ActivityPoint,
  ActivityProgram,
  ActivityTimeline,
} from './types';

export class ActivityTimelineResponseError extends Error {
  constructor() {
    super('활동 타임라인 응답 형식이 올바르지 않습니다.');
    this.name = 'ActivityTimelineResponseError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function parseIsoTimestamp(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') return null;

  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value
    ? value
    : null;
}

function parseProgram(value: unknown): ActivityProgram | null {
  if (
    !isRecord(value) ||
    typeof value.programId !== 'string' ||
    typeof value.programName !== 'string' ||
    typeof value.year !== 'number' ||
    !Number.isInteger(value.year) ||
    (value.applicationMode !== 'PERSONAL' && value.applicationMode !== 'TEAM')
  ) {
    return null;
  }

  return {
    programId: value.programId,
    programName: value.programName,
    year: value.year,
    applicationMode: value.applicationMode,
  };
}

/**
 * 선 위의 이름은 `pullRequestCount` 다 — 내부 표현만 `prCount` 로 고정한다.
 *
 * #729 가 백엔드 DTO 를 `prCount` → `pullRequestCount` 로 개명할 때 랭킹 파서만
 * 따라갔고 이 파서는 `prCount` 를 계속 required 로 요구했다. 그래서 점 하나라도
 * 들어오면 `parsePoint` 가 null 을 내고 `parseActivityTimeline` 이 응답 전체를
 * 던졌다 — 활동이 있는 학생에게 타임라인 화면이 통째로 에러였다.
 *
 * 픽스처가 `prCount` 를 쓰고 있었으므로 단위 테스트는 전부 통과했다.
 * 그래서 아래 스펙은 **선 위의 이름**을 고정한다.
 */
function parsePoint(
  value: unknown,
  granularity: ActivityGranularity,
): ActivityPoint | null {
  const periodPattern =
    granularity === 'MONTH' ? /^\d{4}-(0[1-9]|1[0-2])$/ : /^\d{4}$/;

  if (
    !isRecord(value) ||
    typeof value.period !== 'string' ||
    !periodPattern.test(value.period) ||
    !isNonNegativeInteger(value.commitCount) ||
    !isNonNegativeInteger(value.pullRequestCount) ||
    !isNonNegativeInteger(value.releaseCount) ||
    !isNonNegativeInteger(value.total) ||
    value.total !==
      value.commitCount + value.pullRequestCount + value.releaseCount
  ) {
    return null;
  }

  return {
    period: value.period,
    commitCount: value.commitCount,
    prCount: value.pullRequestCount,
    releaseCount: value.releaseCount,
    total: value.total,
  };
}

function parseActivityTimeline(
  value: unknown,
  requestedGranularity: ActivityGranularity,
): ActivityTimeline {
  if (!isRecord(value)) {
    throw new ActivityTimelineResponseError();
  }

  const { programs: rawPrograms, series: rawSeries } = value;
  const dataAsOf = parseIsoTimestamp(value.dataAsOf);
  if (
    (value.dataAsOf !== null && dataAsOf === null) ||
    !Array.isArray(rawPrograms) ||
    !isRecord(rawSeries)
  ) {
    throw new ActivityTimelineResponseError();
  }

  const { granularity, points: rawPoints } = rawSeries;
  if (
    (granularity !== 'MONTH' && granularity !== 'YEAR') ||
    granularity !== requestedGranularity ||
    !Array.isArray(rawPoints)
  ) {
    throw new ActivityTimelineResponseError();
  }

  const programs = rawPrograms.map(parseProgram);
  const points = rawPoints.map((point) => parsePoint(point, granularity));

  if (
    programs.some((program) => program === null) ||
    points.some((point) => point === null)
  ) {
    throw new ActivityTimelineResponseError();
  }

  return {
    dataAsOf,
    programs: programs.filter((program) => program !== null),
    series: {
      granularity,
      points: points.filter((point) => point !== null),
    },
  };
}

export async function fetchActivityTimeline(
  granularity: ActivityGranularity,
): Promise<ActivityTimeline> {
  const search = new URLSearchParams({ granularity });
  const response = await apiClient<unknown>(
    `dashboard/student/activity-timeline?${search.toString()}`,
  );
  return parseActivityTimeline(response, granularity);
}

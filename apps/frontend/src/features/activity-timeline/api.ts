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
    !isNonNegativeInteger(value.prCount) ||
    !isNonNegativeInteger(value.starCount) ||
    !isNonNegativeInteger(value.total)
  ) {
    return null;
  }

  return {
    period: value.period,
    commitCount: value.commitCount,
    prCount: value.prCount,
    starCount: value.starCount,
    total: value.total,
  };
}

function parseActivityTimeline(value: unknown): ActivityTimeline {
  if (!isRecord(value)) {
    throw new ActivityTimelineResponseError();
  }

  const { programs: rawPrograms, series: rawSeries } = value;
  if (!Array.isArray(rawPrograms) || !isRecord(rawSeries)) {
    throw new ActivityTimelineResponseError();
  }

  const { granularity, points: rawPoints } = rawSeries;
  if (
    (granularity !== 'MONTH' && granularity !== 'YEAR') ||
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
  return parseActivityTimeline(response);
}

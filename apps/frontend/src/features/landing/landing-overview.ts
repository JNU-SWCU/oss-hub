import { isRecord } from '@/lib/is-record';

export interface LandingProgram {
  readonly coverImageUrl?: string | null;
  readonly id: string;
  readonly name: string;
  readonly organizers: readonly string[];
  readonly trackType: string | null;
  readonly applicationEndAt: string;
}

export interface LandingProgramName {
  readonly id: string;
  readonly name: string;
}

interface LandingStatsCounts {
  readonly programCount: number;
  readonly repositoryCount: number;
  readonly contributorCount: number;
}

const INVALID_RESPONSE_MESSAGE = '랜딩 공개 응답 형식이 올바르지 않습니다';

class LandingOverviewResponseError extends Error {
  constructor() {
    super(INVALID_RESPONSE_MESSAGE);
    this.name = 'LandingOverviewResponseError';
  }
}

function invalidResponse(): never {
  throw new LandingOverviewResponseError();
}

function record(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  return invalidResponse();
}

function nonEmptyString(value: unknown): string {
  if (typeof value === 'string' && value.trim().length > 0) return value;
  return invalidResponse();
}

function nonEmptyStringList(value: unknown): readonly string[] {
  if (Array.isArray(value) && value.length > 0)
    return value.map(nonEmptyString);
  return invalidResponse();
}

function publicId(value: unknown): string {
  const parsed = nonEmptyString(value);
  if (/^[A-Za-z0-9_:-]+$/.test(parsed)) return parsed;
  return invalidResponse();
}

function isoDate(value: unknown): string {
  const parsed = nonEmptyString(value);
  const date = new Date(parsed);
  if (!Number.isNaN(date.getTime()) && date.toISOString() === parsed) {
    return parsed;
  }
  return invalidResponse();
}

export function parseLandingProgramPage(
  value: unknown,
): readonly LandingProgram[] {
  const page = record(value);
  if (!Array.isArray(page.items)) return invalidResponse();
  return page.items.slice(0, 3).map((item) => {
    const input = record(item);
    if ('category' in input) invalidResponse();
    if (
      input.coverImageUrl !== undefined &&
      input.coverImageUrl !== null &&
      typeof input.coverImageUrl !== 'string'
    )
      invalidResponse();
    const parsedTrackType = input.trackType;
    if (
      parsedTrackType !== null &&
      parsedTrackType !== 'CURRICULAR' &&
      parsedTrackType !== 'EXTRACURRICULAR'
    ) {
      invalidResponse();
    }
    return {
      id: publicId(input.id),
      ...(input.coverImageUrl === undefined
        ? {}
        : {
            coverImageUrl:
              input.coverImageUrl === null ? null : String(input.coverImageUrl),
          }),
      name: nonEmptyString(input.name),
      organizers: nonEmptyStringList(input.organizers),
      trackType: parsedTrackType === null ? null : String(parsedTrackType),
      applicationEndAt: isoDate(input.applicationEndAt),
    };
  });
}

export function parseLandingProgramNamePage(
  value: unknown,
): readonly LandingProgramName[] {
  const page = record(value);
  if (!Array.isArray(page.items)) return invalidResponse();
  return page.items.map((item) => {
    const input = record(item);
    return { id: publicId(input.id), name: nonEmptyString(input.name) };
  });
}

function boundedCount(value: unknown, max: number): number {
  if (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= max
  )
    return value;
  return invalidResponse();
}

export function parseLandingStatsCounts(value: unknown): LandingStatsCounts {
  const input = record(value);
  return {
    programCount: boundedCount(input.programCount, 3),
    repositoryCount: boundedCount(input.repositoryCount, 3),
    contributorCount: boundedCount(input.contributorCount, 6),
  };
}

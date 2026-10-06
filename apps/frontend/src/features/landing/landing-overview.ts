export type LandingGraphNodeKind = 'program' | 'repository' | 'student';

export interface LandingGraphNode {
  readonly id: string;
  readonly kind: LandingGraphNodeKind;
  readonly label: string;
  readonly href: string | null;
  readonly x: number;
  readonly y: number;
}

export interface LandingGraphEdge {
  readonly sourceId: string;
  readonly targetId: string;
  readonly label: '기여' | '운영';
}

export interface LandingGraph {
  readonly source: 'public' | 'example';
  readonly nodes: readonly LandingGraphNode[];
  readonly edges: readonly LandingGraphEdge[];
}

export type LandingGraphCompleteness = 'complete' | 'partial';

export interface LandingProgram {
  readonly coverImageUrl?: string | null;
  readonly id: string;
  readonly name: string;
  readonly organizer: string;
  readonly trackType: string | null;
  readonly applicationEndAt: string;
}

export interface LandingArchiveItem {
  readonly projectId: string;
  readonly programId: string;
  readonly programName: string;
  readonly displayName: string;
  readonly detailUrl: string;
}

export interface LandingArchiveDetail {
  readonly projectId: string;

  readonly contributors: readonly { readonly githubLogin: string }[];
}

const INVALID_RESPONSE_MESSAGE = '랜딩 공개 응답 형식이 올바르지 않습니다';

export class LandingOverviewResponseError extends Error {
  constructor() {
    super(INVALID_RESPONSE_MESSAGE);
    this.name = 'LandingOverviewResponseError';
  }
}

function invalidResponse(): never {
  throw new LandingOverviewResponseError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  return invalidResponse();
}

function nonEmptyString(value: unknown): string {
  if (typeof value === 'string' && value.trim().length > 0) return value;
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
      organizer: nonEmptyString(input.organizer),
      trackType: parsedTrackType === null ? null : String(parsedTrackType),
      applicationEndAt: isoDate(input.applicationEndAt),
    };
  });
}

export function parseLandingArchivePage(
  value: unknown,
): readonly LandingArchiveItem[] {
  const page = record(value);
  if (!Array.isArray(page.items)) return invalidResponse();
  return page.items.slice(0, 3).map((item) => {
    const input = record(item);

    const projectId = publicId(input.projectId);
    return {
      projectId,
      programId: publicId(input.programId),
      programName: nonEmptyString(input.programName),
      displayName: nonEmptyString(input.displayName),
      detailUrl: `/archive/${projectId}`,
    };
  });
}

export function parseLandingArchiveDetail(
  value: unknown,
): LandingArchiveDetail {
  const input = record(value);
  if (!Array.isArray(input.contributors)) return invalidResponse();
  return {
    projectId: publicId(input.projectId),
    contributors: input.contributors.slice(0, 2).map((contributor) => {
      const parsed = record(contributor);
      return { githubLogin: nonEmptyString(parsed.githubLogin) };
    }),
  };
}

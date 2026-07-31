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

export interface LandingProgram {
  readonly id: string;
  readonly name: string;
  readonly organizer: string;
  readonly category: string;
  readonly applicationEndAt: string;
}

export interface LandingArchiveItem {
  readonly repositoryId: string;
  readonly programId: string;
  readonly programName: string;
  readonly displayName: string;
  readonly detailUrl: string;
}

export interface LandingArchiveDetail {
  readonly repositoryId: string;
  readonly contributors: readonly {
    readonly userId: string;
    readonly githubNickname: string;
  }[];
}

const INVALID_RESPONSE_MESSAGE =
  '랜딩 공개 응답 형식이 올바르지 않습니다';

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
  if (/^[A-Za-z0-9_-]+$/.test(parsed)) return parsed;
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

export function parseLandingProgramPage(value: unknown): readonly LandingProgram[] {
  const page = record(value);
  if (!Array.isArray(page.items)) return invalidResponse();
  return page.items.slice(0, 3).map((item) => {
    const input = record(item);
    return {
      id: publicId(input.id),
      name: nonEmptyString(input.name),
      organizer: nonEmptyString(input.organizer),
      category: nonEmptyString(input.category),
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
    const repositoryId = publicId(input.repositoryId);
    const detailUrl = nonEmptyString(input.detailUrl);
    if (detailUrl !== `/archive/${repositoryId}`) return invalidResponse();
    return {
      repositoryId,
      programId: publicId(input.programId),
      programName: nonEmptyString(input.programName),
      displayName: nonEmptyString(input.displayName),
      detailUrl,
    };
  });
}

export function parseLandingArchiveDetail(
  value: unknown,
): LandingArchiveDetail {
  const input = record(value);
  if (!Array.isArray(input.contributors)) return invalidResponse();
  return {
    repositoryId: publicId(input.repositoryId),
    contributors: input.contributors.slice(0, 2).map((contributor) => {
      const parsed = record(contributor);
      return {
        userId: publicId(parsed.userId),
        githubNickname: nonEmptyString(parsed.githubNickname),
      };
    }),
  };
}

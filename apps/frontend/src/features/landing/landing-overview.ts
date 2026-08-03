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

/**
 * 그래프에 반영되지 못한 공개 데이터가 있는지.
 *
 * - `complete` — 반영해야 할 응답이 모두 반영됐다. 상세가 아직 도착하지 않은
 *   1단계 그래프도 여기 속한다. 기여자가 아직 0이라 화면이 `—`로 내보내므로
 *   틀린 수를 정확한 수처럼 보여 주는 일이 없다.
 * - `partial` — 상세 요청 일부가 전송 단계에서 실패해 기여자가 실제보다 적다.
 *   화면은 이 수를 정확한 값으로 내보이면 안 된다.
 */
export type LandingGraphCompleteness = 'complete' | 'partial';

export interface LandingProgram {
  readonly id: string;
  readonly name: string;
  readonly organizer: string;
  readonly category: string;
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
  /**
   * 공개 아카이브 계약에는 이제 내부 사용자 id가 없다. 기여자를 가리키는 값은
   * GitHub 로그인뿐이라 랜딩도 그 사람의 GitHub 프로필로 보낸다.
   */
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

export function parseLandingProgramPage(
  value: unknown,
): readonly LandingProgram[] {
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
    // 목록 응답에는 detailUrl 이 없다 — 상세 경로는 화면 쪽 규칙이라 여기서 만든다.
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

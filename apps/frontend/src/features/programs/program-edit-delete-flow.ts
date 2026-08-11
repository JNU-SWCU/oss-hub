import { ApiError } from '@/lib/api-client';
import { programHref } from './program-paths';

/** 백엔드 `ProblemDetailBlockingCounts`(error-code.ts) 미러 — 삭제를 막는 종류별 건수. */
export interface ProgramDeleteBlockingCounts {
  readonly applications: number;
  readonly teams: number;
  readonly submissions: number;
  readonly boardPosts: number;
}

export interface ProgramDeleteBlockingMessage {
  readonly text: string;
  /** `boardPosts`만 해소 경로(게시판)가 있어 링크를 붙인다. */
  readonly boardHref?: string;
}

export type ProgramDeleteError =
  | {
      readonly kind: 'blocked';
      readonly messages: readonly ProgramDeleteBlockingMessage[];
    }
  | { readonly kind: 'generic'; readonly message: string };

export const PROGRAM_DELETE_BLOCKED_CODE = 'PRG_012';

export const PROGRAM_DELETE_FAILED_MESSAGE =
  '프로그램을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.';

function isProgramDeleteBlockingCounts(
  value: unknown,
): value is ProgramDeleteBlockingCounts {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.applications === 'number' &&
    typeof record.teams === 'number' &&
    typeof record.submissions === 'number' &&
    typeof record.boardPosts === 'number'
  );
}

/**
 * 409(PRG_012)의 `blockingCounts`를 카테고리별로 다른 문구로 나눈다(#875).
 *
 * `applications`/`teams`는 staff가 지울 방법이 없어 사실만 말하고, `boardPosts`는
 * 게시판에서 직접 지울 수 있어 다음 행동을 알려준다. `submissions`는 applications가
 * 0이면 트랜지티브하게 0이므로(코드가 방어적으로 세기만 한다) 별도 문구가 없다.
 */
export function mapProgramDeleteError(
  error: unknown,
  programId: string,
): ProgramDeleteError {
  if (!(error instanceof ApiError)) {
    return { kind: 'generic', message: PROGRAM_DELETE_FAILED_MESSAGE };
  }
  if (
    error.problem.status !== 409 ||
    error.problem.code !== PROGRAM_DELETE_BLOCKED_CODE
  ) {
    return {
      kind: 'generic',
      message: error.problem.detail || PROGRAM_DELETE_FAILED_MESSAGE,
    };
  }
  const blockingCounts = (error.problem as { blockingCounts?: unknown })
    .blockingCounts;
  if (!isProgramDeleteBlockingCounts(blockingCounts)) {
    return { kind: 'generic', message: PROGRAM_DELETE_FAILED_MESSAGE };
  }
  const messages = blockingMessages(blockingCounts, programId);
  if (messages.length === 0) {
    return { kind: 'generic', message: PROGRAM_DELETE_FAILED_MESSAGE };
  }
  return { kind: 'blocked', messages };
}

function blockingMessages(
  counts: ProgramDeleteBlockingCounts,
  programId: string,
): readonly ProgramDeleteBlockingMessage[] {
  const messages: ProgramDeleteBlockingMessage[] = [];
  if (counts.boardPosts > 0) {
    messages.push({
      text: `게시글 ${counts.boardPosts}개가 남아 있습니다. 게시판에서 지운 뒤 다시 시도하세요.`,
      boardHref: programHref(programId, '/board'),
    });
  }
  if (counts.applications > 0 || counts.teams > 0) {
    const parts: string[] = [];
    if (counts.applications > 0) parts.push(`신청 ${counts.applications}건`);
    if (counts.teams > 0) parts.push(`팀 ${counts.teams}개`);
    // 마지막 단위 명사에 맞는 조사를 고른다 — '건'은 받침이 있어 '이', '개'는 받침이
    // 없어 '가'(신청 단독이면 "…건이", 팀 단독/조합이면 "…개가").
    const particle = parts[parts.length - 1]?.endsWith('건') ? '이' : '가';
    messages.push({
      text: `${parts.join(' / ')}${particle} 남아 있습니다. 학생 데이터가 있는 프로그램은 지울 수 없습니다.`,
    });
  }
  return messages;
}

import { ApiError } from '@/lib/api-client';
import { programDocumentsHref } from '@/lib/program-route';
import type { ProgramDeletionScopeCounts } from './api';
import { programHref } from './program-paths';

/** 백엔드 `ProblemDetailBlockingCounts` 미러 — 기존 guarded delete를 막는 4종 자식 수. */
export interface ProgramDeleteBlockingCounts {
  readonly applications: number;
  readonly teams: number;
  readonly submissions: number;
  readonly boardPosts: number;
}

export interface ProgramDeleteBlockingItem {
  readonly label: string;
  readonly count: number;
  readonly unit: string;
  readonly href: string;
}

export type ProgramDeleteError =
  | {
      readonly kind: 'blocked';
      readonly counts: ProgramDeleteBlockingCounts;
      readonly items: readonly ProgramDeleteBlockingItem[];
    }
  | { readonly kind: 'generic'; readonly message: string };

export const PROGRAM_DELETE_BLOCKED_CODE = 'PRG_012';

/** purge 확인-재확인 사이에 범위가 바뀜(TOCTOU) 409 코드(#F2). */
export const PROGRAM_PURGE_SCOPE_CHANGED_CODE = 'PRG_014';

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

function isProgramDeletionScopeCounts(
  value: unknown,
): value is ProgramDeletionScopeCounts {
  return (
    isProgramDeleteBlockingCounts(value) &&
    typeof (value as { readonly submissionEvents?: unknown })
      .submissionEvents === 'number' &&
    typeof (value as { readonly scopeFingerprint?: unknown })
      .scopeFingerprint === 'string'
  );
}

/**
 * 409(PRG_014)에서 현재 범위(`currentScopeCounts`)를 꾼다. 있으면 재확인을 요구하는
 * 화면이 새 카운트를 보여줌 — 자동 재시도는 하지 않는다(#F2).
 */
export function purgeScopeChangedCounts(
  error: unknown,
): ProgramDeletionScopeCounts | null {
  if (!(error instanceof ApiError)) return null;
  if (
    error.problem.status !== 409 ||
    error.problem.code !== PROGRAM_PURGE_SCOPE_CHANGED_CODE
  ) {
    return null;
  }
  const currentScopeCounts = (error.problem as { currentScopeCounts?: unknown })
    .currentScopeCounts;
  return isProgramDeletionScopeCounts(currentScopeCounts)
    ? currentScopeCounts
    : null;
}

/** 409(PRG_012)의 차단 건수를 실제 교직원 관리 화면과 함께 전달한다. */
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
  const items = blockingItems(blockingCounts, programId);
  if (items.length === 0) {
    return { kind: 'generic', message: PROGRAM_DELETE_FAILED_MESSAGE };
  }
  return { kind: 'blocked', counts: blockingCounts, items };
}

function blockingItems(
  counts: ProgramDeleteBlockingCounts,
  programId: string,
): readonly ProgramDeleteBlockingItem[] {
  const candidates = [
    {
      label: '지원서',
      count: counts.applications,
      unit: '건',
      href: programHref(programId, '/applicants'),
    },
    {
      label: '팀',
      count: counts.teams,
      unit: '개',
      href: programHref(programId, '/teams'),
    },
    {
      label: '게시글',
      count: counts.boardPosts,
      unit: '건',
      href: programHref(programId, '/board'),
    },
    {
      label: '제출물',
      count: counts.submissions,
      unit: '건',
      href: programDocumentsHref(programId),
    },
  ] as const;
  return candidates.filter((item) => item.count > 0);
}

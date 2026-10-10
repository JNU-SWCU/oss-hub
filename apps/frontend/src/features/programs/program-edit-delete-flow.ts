import { ApiError } from '@/lib/api-client';
import { programDocumentsHref } from '@/lib/program-route';
import type { ProgramDeletionScopeCounts } from './api';
import { programHref } from './program-paths';

interface ProgramDeleteBlockingCounts {
  readonly applications: number;
  readonly teams: number;
  readonly submissions: number;
  readonly boardPosts: number;
}

interface ProgramDeleteBlockingItem {
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
      href: programHref(programId, '/teams'),
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

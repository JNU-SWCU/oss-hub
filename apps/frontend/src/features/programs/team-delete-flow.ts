import { ApiError } from '@/lib/api-client';
import type { TeamDeletedCounts, TeamDeletionScope } from './types';

/** 확인-삭제 사이에 범위가 바뀜(TOCTOU) 409 코드. */
export const TEAM_DELETE_SCOPE_CHANGED_CODE = 'TEAM_019';

export const TEAM_DELETE_FAILED_MESSAGE =
  '팀을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.';

const TEAM_DELETE_COUNT_ITEMS = [
  ['applications', '지원서', '건'],
  ['members', '팀원', '명'],
  ['invitations', '초대', '건'],
  ['submissions', '제출물', '건'],
  ['submissionEvents', '제출 이력', '건'],
  ['detachedRepositories', '저장소 연결 해제', '건'],
] as const satisfies ReadonlyArray<
  readonly [keyof TeamDeletedCounts, string, string]
>;

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isTeamDeletionScope(value: unknown): value is TeamDeletionScope {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    isCount(record.applications) &&
    isCount(record.members) &&
    isCount(record.invitations) &&
    isCount(record.submissions) &&
    isCount(record.submissionEvents) &&
    isCount(record.detachedRepositories) &&
    typeof record.scopeFingerprint === 'string'
  );
}

/**
 * 409(TEAM_019)에서 현재 범위(`currentTeamScopeCounts`)를 꾼다.
 * 있으면 재확인을 요구하는 화면이 새 카운트를 보여줌 — 자동 재시도는 하지 않는다.
 */
export function teamDeleteScopeChangedCounts(
  error: unknown,
): TeamDeletionScope | null {
  if (!(error instanceof ApiError)) return null;
  if (
    error.problem.status !== 409 ||
    error.problem.code !== TEAM_DELETE_SCOPE_CHANGED_CODE
  ) {
    return null;
  }
  const currentTeamScopeCounts = (
    error.problem as { currentTeamScopeCounts?: unknown }
  ).currentTeamScopeCounts;
  return isTeamDeletionScope(currentTeamScopeCounts)
    ? currentTeamScopeCounts
    : null;
}

/** 서버가 준 `detail`이 있으면 그대로 쓰고, 없으면 팀 삭제 일반 실패 문장으로 떨어진다. */
export function teamDeleteErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return TEAM_DELETE_FAILED_MESSAGE;
  return error.problem.detail || TEAM_DELETE_FAILED_MESSAGE;
}

/** 0건은 빼고, 전부 0이면 연결된 데이터가 없었다고만 말한다. */
export function formatTeamDeletedCounts(counts: TeamDeletedCounts): string {
  const summary = TEAM_DELETE_COUNT_ITEMS.filter(([key]) => counts[key] > 0)
    .map(([key, label, unit]) => `${label} ${counts[key]}${unit}`)
    .join(' · ');
  return summary || '연결된 데이터가 없었습니다.';
}

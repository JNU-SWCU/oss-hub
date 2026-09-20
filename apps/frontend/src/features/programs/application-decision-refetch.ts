import { ApiError } from '@/lib/api-client';
import type { ApplicationDecisionInput } from './api';
import type { ApplicationListItem, ApplicationStatus } from './types';

/**
 * 교직원이 고를 수 있는 세 상태. 어느 출발점에서도 **셋 다 항상 고를 수 있다**(AC-14).
 *
 * 목록과 상세가 같은 배열을 쓴다 — 각자 선언하면 한쪽에만 상태가 하나 늘어난다.
 */
export const DECISION_OPTIONS: readonly ApplicationStatus[] = [
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
];

/**
 * 고른 상태를 판정 요청으로 옮긴다. 반려는 사유가 있어야 하며, 없으면 `null`을 돌려
 * 부르는 화면이 입력 오류를 표시하게 한다 — 사유 없는 반려를 서버까지 보내지 않는다.
 */
export function decisionInputFor(
  next: ApplicationStatus,
  reason: string,
): ApplicationDecisionInput | null {
  if (next === 'APPROVED') return { action: 'APPROVE' };
  if (next === 'SUBMITTED') return { action: 'REVERT' };
  const trimmed = reason.trim();
  return trimmed === '' ? null : { action: 'REJECT', reason: trimmed };
}

/**
 * 판정 요청이 어떻게 끝났는가. 서버가 무엇을 돌려줬는지만 담고 「그래서 행이 어떻게
 * 되는가」는 담지 않는다 — 그 답은 재조회가 준다.
 */
export type DecisionOutcome =
  /** 2xx. 요청한 판정이 실제로 적용됐다. */
  | { readonly kind: 'applied' }
  /** 409. 다른 사람이 먼저 판정해 이 요청은 밀렸다. */
  | { readonly kind: 'stale' }
  /** 404. 신청이 이미 사라졌다(학생이 취소했거나 팀이 지워졌다). */
  | { readonly kind: 'gone' }
  /** 5xx·네트워크. 적용됐는지 **알 수 없다**. */
  | { readonly kind: 'unknown'; readonly error: unknown };

/**
 * 판정과 재조회를 한 번에 돌린 결과.
 *
 * 두 축을 따로 담는 것이 이 타입의 요점이다. `outcome`은 「내 요청이 어떻게 됐나」이고
 * `refetch`는 「지금 이 행의 진짜 상태가 무엇인가」다. 하나로 합치면 5xx 뒤에 재조회가
 * 성공해 실제로는 반영된 경우를 「실패」로 말하게 된다.
 */
export type DecisionRefetchResult =
  | {
      readonly kind: 'refreshed';
      readonly outcome: DecisionOutcome;
      readonly application: ApplicationListItem;
    }
  /** 재조회가 404 — 행을 목록에서 빼거나 상세에서 나가야 한다. */
  | { readonly kind: 'removed'; readonly outcome: DecisionOutcome }
  /**
   * 재조회 자체가 실패했다. 지금 화면에 있는 값이 맞는지 알 수 없으므로 이 행의 다음
   * 판정을 막는다 — 모르는 상태 위에서 또 판정하면 두 번 뒤집는다.
   */
  | {
      readonly kind: 'refetch-failed';
      readonly outcome: DecisionOutcome;
      readonly error: unknown;
    };

export interface DecisionRefetchPorts {
  /** 판정 요청. 성공하면 resolve, 실패하면 reject 한다. */
  readonly decide: () => Promise<unknown>;
  /** 그 행 단건 재조회. 404면 `ApiError`로 reject 해야 한다. */
  readonly refetch: () => Promise<ApplicationListItem>;
}

function classifyDecision(error: unknown): DecisionOutcome {
  if (!(error instanceof ApiError)) return { kind: 'unknown', error };
  const { status } = error.problem;
  if (status === 409) return { kind: 'stale' };
  if (status === 404) return { kind: 'gone' };
  return { kind: 'unknown', error };
}

function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.problem.status === 404;
}

/**
 * 판정하고 **무조건** 그 행을 다시 읽는다.
 *
 * 무조건인 것이 계약이다(확정 사실 `f-row-decision-refresh`). 서버 응답 바디로 새 상태를
 * 대신 받지 않는 이유는 두 가지다 — 판정이 5xx로 끝나도 실제로는 적용됐을 수 있고,
 * 409로 밀렸어도 그 행의 현재 상태는 알아야 화면이 거짓말을 하지 않는다.
 *
 * 낙관적 갱신을 하지 않는다. 요청 결과로 행을 먼저 바꾸면 재조회가 그것을 되돌릴 때
 * 화면이 두 번 깜빡이고, 되돌리지 못하면 잘못된 상태가 남는다.
 *
 * 목록과 상세가 이 함수 하나를 공유한다. 두 화면이 각자 구현하면 재조회 실패 같은
 * 드문 가지가 한쪽에만 생긴다.
 */
export async function runDecisionWithRefetch(
  ports: DecisionRefetchPorts,
): Promise<DecisionRefetchResult> {
  let outcome: DecisionOutcome;
  try {
    await ports.decide();
    outcome = { kind: 'applied' };
  } catch (error) {
    outcome = classifyDecision(error);
  }

  try {
    return { kind: 'refreshed', outcome, application: await ports.refetch() };
  } catch (error) {
    if (isNotFound(error)) return { kind: 'removed', outcome };
    return { kind: 'refetch-failed', outcome, error };
  }
}

/**
 * 이 행의 다음 판정을 막아야 하는가.
 *
 * 재조회가 실패한 경우만 막는다. 409·404·5xx는 재조회가 성공했다면 화면이 진짜 상태를
 * 들고 있으므로 계속 조작할 수 있다.
 */
export function blocksFurtherDecisions(result: DecisionRefetchResult): boolean {
  return result.kind === 'refetch-failed';
}

/**
 * 판정 결과를 사용자에게 할 말 한 줄로 옮긴다. `null`이면 할 말이 없다 — 요청한
 * 대로 됐고 화면이 이미 그것을 보이고 있다.
 *
 * 목록과 상세가 같은 문구를 쓴다. 각자 쓰면 같은 일이 화면마다 다르게 들린다.
 */
export function decisionNoticeFor(
  result: DecisionRefetchResult,
): string | null {
  if (result.kind === 'refetch-failed') {
    return '판정 결과를 확인하지 못했습니다. 새로고침한 뒤 이 신청의 상태를 다시 확인해 주세요.';
  }
  if (result.kind === 'removed') return '이 신청은 더 이상 없습니다.';
  switch (result.outcome.kind) {
    case 'applied':
      return null;
    case 'stale':
      return '다른 사람이 먼저 판정했습니다. 최신 상태로 갱신했습니다.';
    case 'gone':
      return '이 신청은 더 이상 없습니다.';
    case 'unknown':
      return '판정 요청이 실패했습니다. 갱신한 상태를 보고 다시 시도해 주세요.';
  }
}

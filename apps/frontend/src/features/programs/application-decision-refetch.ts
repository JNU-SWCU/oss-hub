import { ApiError } from '@/lib/api-client';
import type { ApplicationDecisionInput } from './api';
import type { ApplicationListItem, ApplicationStatus } from './types';

export const DECISION_OPTIONS: readonly ApplicationStatus[] = [
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
];

export function decisionInputFor(
  next: ApplicationStatus,
  reason: string,
): ApplicationDecisionInput | null {
  if (next === 'APPROVED') return { action: 'APPROVE' };
  if (next === 'SUBMITTED') return { action: 'REVERT' };
  const trimmed = reason.trim();
  return trimmed === '' ? null : { action: 'REJECT', reason: trimmed };
}

export type DecisionOutcome =
  | { readonly kind: 'applied' }
  | { readonly kind: 'stale' }
  | { readonly kind: 'gone' }
  | { readonly kind: 'unknown'; readonly error: unknown };

export type DecisionRefetchResult =
  | {
      readonly kind: 'refreshed';
      readonly outcome: DecisionOutcome;
      readonly application: ApplicationListItem;
    }
  | { readonly kind: 'removed'; readonly outcome: DecisionOutcome }
  | {
      readonly kind: 'refetch-failed';
      readonly outcome: DecisionOutcome;
      readonly error: unknown;
    };

export interface DecisionRefetchPorts {
  readonly decide: () => Promise<unknown>;

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

export function blocksFurtherDecisions(result: DecisionRefetchResult): boolean {
  return result.kind === 'refetch-failed';
}

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

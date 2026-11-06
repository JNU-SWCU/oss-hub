import { ApiError } from '@/lib/api-client';
import { REQUIREMENT_REVIEW_ERROR_CODES } from './requirement-review-api';

export type RequirementReloadResult = 'reloaded' | 'failed';

export type RequirementCollectionReloadResult =
  RequirementReloadResult | 'superseded';

export type RequirementReviewConflict =
  'review-changed' | 'target-changed' | 'submission-missing';

function hasProblemCode(error: unknown, code: string): boolean {
  return error instanceof ApiError && error.problem.code === code;
}

export function requirementReviewConflictOf(
  error: unknown,
): RequirementReviewConflict | null {
  if (
    hasProblemCode(error, REQUIREMENT_REVIEW_ERROR_CODES.REVIEW_TARGET_CHANGED)
  ) {
    return 'target-changed';
  }
  if (hasProblemCode(error, REQUIREMENT_REVIEW_ERROR_CODES.REVIEW_CHANGED)) {
    return 'review-changed';
  }
  if (
    hasProblemCode(error, REQUIREMENT_REVIEW_ERROR_CODES.SUBMISSION_NOT_FOUND)
  ) {
    return 'submission-missing';
  }
  return null;
}

export function isRequirementReviewTargetChanged(
  conflict: RequirementReviewConflict,
): boolean {
  return conflict === 'target-changed';
}

const REVIEW_CONFLICT_LEAD: Readonly<
  Record<RequirementReviewConflict, string>
> = {
  'target-changed':
    '검토하는 사이에 이 서류의 제출물 또는 검토 결과가 바뀌어, 방금 고른 결과는 저장하지 않았습니다.',
  'review-changed':
    '검토하는 사이에 다른 검토 결과가 먼저 등록되어, 방금 고른 결과는 저장하지 않았습니다.',
  'submission-missing':
    '검토하려던 제출을 찾지 못해, 방금 고른 결과는 저장하지 않았습니다.',
};

const REVIEW_CONFLICT_RELOAD_TAIL: Readonly<
  Record<RequirementReloadResult, string>
> = {
  reloaded:
    '표를 최신 내용으로 다시 불러왔습니다 — 제출 내용을 다시 확인한 뒤 다시 검토해 주세요.',
  failed:
    '최신 표를 불러오지 못했습니다. 「다시 시도」 후 제출 내용을 확인해 다시 검토해 주세요.',
};

export function requirementReviewConflictNotice(
  conflict: RequirementReviewConflict,
  result: RequirementCollectionReloadResult,
): string | null {
  if (result === 'superseded') return null;
  if (result === 'reloaded' && !isRequirementReviewTargetChanged(conflict))
    return null;
  return `${REVIEW_CONFLICT_LEAD[conflict]} ${REVIEW_CONFLICT_RELOAD_TAIL[result]}`;
}

export function isRequirementSubmitReviewChanged(error: unknown): boolean {
  return (
    hasProblemCode(error, 'MSD_048') ||
    hasProblemCode(error, REQUIREMENT_REVIEW_ERROR_CODES.REVIEW_CHANGED)
  );
}

export function requirementSubmitConflictNotice(
  documentName: string,
  result: RequirementReloadResult,
): string {
  const lead = `제출하는 사이에 「${documentName}」의 제출본 또는 검토 결과가 바뀌어, 방금 제출은 저장되지 않았습니다.`;
  return result === 'reloaded'
    ? `${lead} 서류 상태를 다시 불러왔습니다 — 검토 내용을 확인한 뒤 진행해 주세요.`
    : `${lead} 서류 상태를 다시 불러오지 못했습니다 — 「다시 시도」로 불러온 뒤 검토 내용을 확인해 주세요.`;
}

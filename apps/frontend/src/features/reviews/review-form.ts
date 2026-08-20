import type { ReviewDecision } from './types';

export type ReviewDecisionInput = ReviewDecision | '';

export function reviewFormError(
  decision: ReviewDecisionInput,
  comment: string,
): string | null {
  if (decision === '') return '승인, 보완 요청, 반려 중 하나를 골라 주세요.';
  if (
    (decision === 'CHANGES_REQUESTED' || decision === 'REJECTED') &&
    comment.trim() === ''
  ) {
    return '보완 요청과 최종 반려에는 코멘트가 필요합니다.';
  }
  return null;
}

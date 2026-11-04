import type { ReviewDecision } from './types';
import { milestoneDocumentReviewFormError } from '@/lib/requirement-review';

export type ReviewDecisionInput = ReviewDecision | '';

export function reviewFormError(
  decision: ReviewDecisionInput,
  comment: string,
): string | null {
  return milestoneDocumentReviewFormError(
    decision === '' ? null : decision,
    comment,
  );
}

import type { ReviewDecision } from './types';
import { requirementReviewFormError } from '@/lib/requirement-review';

export type ReviewDecisionInput = ReviewDecision | '';

export function reviewFormError(
  decision: ReviewDecisionInput,
  comment: string,
): string | null {
  return requirementReviewFormError(decision === '' ? null : decision, comment);
}

import type { ReviewDecisionInput } from './review-form';
import type { ReviewContext } from './types';

export interface ReviewSession {
  readonly context: ReviewContext | null;
  readonly decision: ReviewDecisionInput;
  readonly comment: string;
  readonly needsLatestRevision: boolean;
}

export const INITIAL_REVIEW_SESSION: ReviewSession = {
  context: null,
  decision: '',
  comment: '',
  needsLatestRevision: false,
};

export function receiveReviewContext(
  session: ReviewSession,
  context: ReviewContext,
): ReviewSession {
  const previousNumber = session.context?.currentRevision.number;
  if (
    previousNumber !== undefined &&
    context.currentRevision.number < previousNumber
  )
    return session;
  const changed =
    previousNumber !== undefined &&
    previousNumber !== context.currentRevision.number;
  return {
    ...session,
    context,
    decision: changed ? '' : session.decision,
    needsLatestRevision: context.currentRevision.review
      ? false
      : changed || session.needsLatestRevision,
  };
}

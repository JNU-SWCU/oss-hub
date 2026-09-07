import type { ReviewDecisionInput } from './review-form';
import type { ReviewContext, SubmissionRevision } from './types';

export interface ReviewSession {
  readonly context: ReviewContext | null;
  readonly original: SubmissionRevision | null;
  readonly decision: ReviewDecisionInput;
  readonly comment: string;
  readonly requiresAcknowledgement: boolean;
  readonly acknowledgedRevision: number | null;
}

export const INITIAL_REVIEW_SESSION: ReviewSession = {
  context: null,
  original: null,
  decision: '',
  comment: '',
  requiresAcknowledgement: false,
  acknowledgedRevision: null,
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
    original: session.original ?? context.currentRevision,
    ...(changed
      ? {
          decision: '',
          requiresAcknowledgement: true,
          acknowledgedRevision: null,
        }
      : {}),
  };
}

export function needsRevisionAcknowledgement(session: ReviewSession): boolean {
  return (
    session.requiresAcknowledgement &&
    session.acknowledgedRevision !== session.context?.currentRevision.number
  );
}

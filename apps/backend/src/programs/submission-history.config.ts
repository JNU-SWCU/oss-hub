import { SubmissionHistoryEvent } from '@prisma/client';

export const SUBMISSION_REVIEW_EVENTS = [
  SubmissionHistoryEvent.APPROVED,
  SubmissionHistoryEvent.REJECTED,
  SubmissionHistoryEvent.CHANGES_REQUESTED,
];

export type SubmissionReviewDecision =
  (typeof SUBMISSION_REVIEW_EVENTS)[number];

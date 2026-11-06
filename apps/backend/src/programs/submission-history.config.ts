import { SubmissionHistoryEvent } from '@prisma/client';

export const SUBMISSION_REVIEW_EVENTS: SubmissionHistoryEvent[] = [
  SubmissionHistoryEvent.APPROVED,
  SubmissionHistoryEvent.REJECTED,
  SubmissionHistoryEvent.CHANGES_REQUESTED,
];

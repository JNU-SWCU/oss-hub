import { MilestoneDocumentSubmissionHistoryEvent } from '@prisma/client';

export const SUBMISSION_REVIEW_EVENTS: MilestoneDocumentSubmissionHistoryEvent[] =
  [
    MilestoneDocumentSubmissionHistoryEvent.APPROVED,
    MilestoneDocumentSubmissionHistoryEvent.REJECTED,
    MilestoneDocumentSubmissionHistoryEvent.CHANGES_REQUESTED,
  ];

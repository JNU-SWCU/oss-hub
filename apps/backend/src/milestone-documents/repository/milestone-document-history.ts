import {
  MilestoneDocumentSubmissionHistoryEvent,
  Prisma,
  type ReviewDecision,
} from '@prisma/client';

export const milestoneDocumentHistoryDescendingOrderBy = [
  { createdAt: 'desc' },
  { id: 'desc' },
] satisfies Prisma.MilestoneDocumentSubmissionHistoryOrderByWithRelationInput[];

export function nextMilestoneDocumentHistoryCreatedAt(
  requested: Date,
  latest: Date | null,
): Date {
  return latest === null || requested.getTime() > latest.getTime()
    ? requested
    : new Date(latest.getTime() + 1);
}

export const boundedReviewHistoryQuery = {
  orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }],
  take: 50,
  select: {
    id: true,
    decision: true,
    comment: true,
    reviewedAt: true,

    resubmissionDueAt: true,
    reviewer: { select: { nickname: true } },
    submissionHistory: { select: { revision: true } },
  },
} satisfies Prisma.MilestoneDocumentSubmission$reviewHistoriesArgs;

export function reviewDecisionToHistoryEvent(
  decision: ReviewDecision,
): MilestoneDocumentSubmissionHistoryEvent {
  switch (decision) {
    case 'APPROVED':
      return MilestoneDocumentSubmissionHistoryEvent.APPROVED;
    case 'CHANGES_REQUESTED':
      return MilestoneDocumentSubmissionHistoryEvent.CHANGES_REQUESTED;
    case 'REJECTED':
      return MilestoneDocumentSubmissionHistoryEvent.REJECTED;
  }
}

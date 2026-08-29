import {
  MilestoneDocumentSubmissionHistoryEvent,
  Prisma,
  type ReviewDecision,
} from '@prisma/client';

/**
 * 최신 페이지부터 읽되 응답 안에서는 다시 시간순으로 뒤집는다.
 * 같은 시각에는 판정을 뒤에 놓아 응답을 뒤집은 뒤 제출·재제출이 먼저 보이게 하고,
 * id로 최종 순서를 고정한다.
 */
export const milestoneDocumentHistoryDescendingOrderBy = [
  { createdAt: 'desc' },
  { event: 'desc' },
  { id: 'desc' },
] satisfies Prisma.MilestoneDocumentSubmissionHistoryOrderByWithRelationInput[];

/** 목록 응답 하나가 영구히 커지지 않도록 제출·판정 각각 최근 50건만 포함한다. */
export const boundedReviewHistoryQuery = {
  orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }],
  take: 50,
  select: {
    id: true,
    decision: true,
    comment: true,
    reviewedAt: true,
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

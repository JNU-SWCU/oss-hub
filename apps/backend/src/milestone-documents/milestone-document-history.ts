import {
  MilestoneDocumentSubmissionHistoryEvent,
  Prisma,
  type ReviewDecision,
} from '@prisma/client';

/**
 * 최신 페이지부터 읽되 응답 안에서는 다시 시간순으로 뒤집는다.
 * runtime writer는 같은 제출 원장의 `createdAt`을 직전 사건보다 최소 1ms 뒤로
 * 보정한다. 이관 전 동률만 id로 결정적으로 고정하며 enum 선언 순서로 인과를 추측하지 않는다.
 */
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

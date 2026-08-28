import {
  MilestoneDocumentSubmissionHistoryEvent,
  Prisma,
  type ReviewDecision,
} from '@prisma/client';
import type { MilestoneDocumentCollectionHistoryRecord } from './milestone-documents.repository';

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

export function collectionHistory(
  submissions: readonly {
    readonly event: MilestoneDocumentSubmissionHistoryEvent;
    readonly revision: number | null;
    readonly comment: string | null;
    readonly content: Prisma.JsonValue | null;
    readonly createdAt: Date;
    readonly actor: { readonly nickname: string };
    readonly files: readonly { readonly originalFileName: string }[];
  }[],
  reviews: readonly {
    readonly decision: ReviewDecision;
    readonly comment: string | null;
    readonly reviewedAt: Date;
    readonly reviewer: { readonly nickname: string };
    readonly submissionHistory: { readonly revision: number | null } | null;
  }[],
): readonly MilestoneDocumentCollectionHistoryRecord[] {
  const submissionEvents = submissions.map((item) => ({
    event: item.event,
    revision: item.revision,
    actorNickname: item.actor.nickname,
    comment: item.comment,
    createdAt: item.createdAt,
    fileName: item.files[0]?.originalFileName ?? null,
    content: item.content ?? null,
  }));
  const reviewEvents = reviews.map((item) => ({
    event: reviewDecisionToHistoryEvent(item.decision),
    revision: item.submissionHistory?.revision ?? null,
    actorNickname: item.reviewer.nickname,
    comment: item.comment,
    createdAt: item.reviewedAt,
    fileName: null,
    content: null,
  }));
  return [...submissionEvents, ...reviewEvents].sort((left, right) => {
    if (left.revision !== null && right.revision !== null) {
      const revisionOrder = left.revision - right.revision;
      if (revisionOrder !== 0) return revisionOrder;
      const leftIsSubmission = isSubmissionEvent(left.event);
      const rightIsSubmission = isSubmissionEvent(right.event);
      if (leftIsSubmission !== rightIsSubmission) {
        return leftIsSubmission ? -1 : 1;
      }
    }
    return left.createdAt.getTime() - right.createdAt.getTime();
  });
}

function isSubmissionEvent(
  event: MilestoneDocumentSubmissionHistoryEvent,
): boolean {
  return (
    event === MilestoneDocumentSubmissionHistoryEvent.SUBMITTED ||
    event === MilestoneDocumentSubmissionHistoryEvent.RESUBMITTED
  );
}

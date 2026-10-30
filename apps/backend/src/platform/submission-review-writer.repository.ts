import type { Prisma, ReviewDecision } from '@prisma/client';

interface SubmissionReviewRecordInput {
  readonly milestoneDocumentSubmissionId: string;
  readonly submissionHistoryId: string;
  readonly reviewerId: string;
  readonly decision: ReviewDecision;
  readonly comment: string | null;
  readonly reviewedAt: Date;
  readonly resubmissionDueAt?: Date | null;
}

interface SubmissionReviewEventInput {
  readonly milestoneDocumentSubmissionId: string;
  readonly revision: number;
  readonly reviewerId: string;
  readonly decision: ReviewDecision;
  readonly comment: string | null;
  readonly reviewedAt: Date;
}

export function appendSubmissionReview<
  TSelect extends Prisma.MilestoneDocumentReviewHistorySelect,
>(
  transaction: Pick<Prisma.TransactionClient, 'milestoneDocumentReviewHistory'>,
  input: SubmissionReviewRecordInput,
  select: TSelect,
) {
  return transaction.milestoneDocumentReviewHistory.create({
    data: {
      milestoneDocumentSubmissionId: input.milestoneDocumentSubmissionId,
      submissionHistoryId: input.submissionHistoryId,
      reviewerId: input.reviewerId,
      decision: input.decision,
      comment: input.comment,
      ...(input.resubmissionDueAt === undefined
        ? {}
        : { resubmissionDueAt: input.resubmissionDueAt }),
      reviewedAt: input.reviewedAt,
    },
    select,
  });
}

export function appendSubmissionReviewEvent(
  transaction: Pick<
    Prisma.TransactionClient,
    'milestoneDocumentSubmissionHistory'
  >,
  input: SubmissionReviewEventInput,
) {
  return transaction.milestoneDocumentSubmissionHistory.create({
    data: {
      milestoneDocumentSubmissionId: input.milestoneDocumentSubmissionId,
      event: input.decision,
      revision: input.revision,
      comment: input.comment,
      actorId: input.reviewerId,
      createdAt: input.reviewedAt,
    },
    select: { id: true },
  });
}

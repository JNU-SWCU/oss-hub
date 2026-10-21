export const MILESTONE_DOCUMENT_REVIEW_DECISIONS = [
  'APPROVED',
  'CHANGES_REQUESTED',
  'REJECTED',
] as const;

export type MilestoneDocumentReviewDecision =
  (typeof MILESTONE_DOCUMENT_REVIEW_DECISIONS)[number];

export interface MilestoneDocumentReviewInput {
  readonly decision: MilestoneDocumentReviewDecision;

  readonly comment?: string;

  readonly resubmissionDueAt?: string;

  readonly expectedRevision: number;

  readonly expectedLatestReviewId: string | null;
}

export interface CreatedMilestoneDocumentReview {
  readonly id: string;
  readonly decision: MilestoneDocumentReviewDecision;
  readonly comment: string | null;
  readonly reviewedAt: string;

  readonly resubmissionDueAt: string | null;

  readonly reviewerNickname: string;
}

import { ReviewDecision, SubmissionStatus } from '@prisma/client';

export interface CreateMilestoneDocumentReviewInput {
  readonly decision: ReviewDecision;
  readonly comment: string | null;

  readonly resubmissionDueAt: Date | null;

  readonly expectedRevision: number;

  readonly expectedLatestReviewId: string | null;
}

export interface MilestoneDocumentReviewRecord {
  readonly id: string;
  readonly decision: ReviewDecision;
  readonly comment: string | null;
  readonly reviewedAt: Date;

  readonly resubmissionDueAt: Date | null;
}

export function reviewDecisionToSubmissionStatus(
  decision: ReviewDecision,
): SubmissionStatus {
  switch (decision) {
    case ReviewDecision.APPROVED:
      return SubmissionStatus.APPROVED;
    case ReviewDecision.CHANGES_REQUESTED:
      return SubmissionStatus.CHANGES_REQUESTED;
    case ReviewDecision.REJECTED:
      return SubmissionStatus.REJECTED;
  }
}

export function isResubmissionAllowedAfter(
  latestDecision: ReviewDecision | null,
): boolean {
  if (latestDecision === null) return true;
  switch (latestDecision) {
    case ReviewDecision.APPROVED:
    case ReviewDecision.REJECTED:
      return false;
    case ReviewDecision.CHANGES_REQUESTED:
      return true;
  }
}

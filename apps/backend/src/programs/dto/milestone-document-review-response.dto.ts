import type { ReviewDecision } from '@prisma/client';
import type { CreatedMilestoneDocumentReview } from '../milestone-document-collection-read.repository';

export class MilestoneDocumentReviewResponseDto {
  declare readonly id: string;
  declare readonly decision: ReviewDecision;
  declare readonly comment: string | null;
  declare readonly reviewedAt: string;

  declare readonly resubmissionDueAt: string | null;
  declare readonly reviewerNickname: string;

  static from(
    review: CreatedMilestoneDocumentReview,
  ): MilestoneDocumentReviewResponseDto {
    return {
      id: review.id,
      decision: review.decision,
      comment: review.comment,
      reviewedAt: review.reviewedAt.toISOString(),
      resubmissionDueAt: review.resubmissionDueAt?.toISOString() ?? null,
      reviewerNickname: review.reviewerNickname,
    };
  }
}

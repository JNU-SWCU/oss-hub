import type { ReviewDecision } from '@prisma/client';
import type { CreatedMilestoneDocumentReview } from '../domain/milestone-document-record';

export class MilestoneDocumentReviewResponseDto {
  id: string;
  decision: ReviewDecision;
  comment: string | null;
  reviewedAt: string;

  resubmissionDueAt: string | null;
  reviewerNickname: string;

  private constructor(review: CreatedMilestoneDocumentReview) {
    this.id = review.id;
    this.decision = review.decision;
    this.comment = review.comment;
    this.reviewedAt = review.reviewedAt.toISOString();
    this.resubmissionDueAt = review.resubmissionDueAt?.toISOString() ?? null;
    this.reviewerNickname = review.reviewerNickname;
  }

  static from(
    review: CreatedMilestoneDocumentReview,
  ): MilestoneDocumentReviewResponseDto {
    return new MilestoneDocumentReviewResponseDto(review);
  }
}

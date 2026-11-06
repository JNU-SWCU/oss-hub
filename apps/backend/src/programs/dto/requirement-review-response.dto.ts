import type { CreatedRequirementReview } from '../requirements.repository';
import type { SubmissionReviewDecision } from '../submissions.repository';
export class RequirementReviewResponseDto {
  declare readonly id: string;
  declare readonly decision: SubmissionReviewDecision;
  declare readonly comment: string | null;
  declare readonly reviewedAt: string;
  declare readonly reviewerNickname: string;
  static from(review: CreatedRequirementReview): RequirementReviewResponseDto {
    return {
      id: review.id,
      decision: review.decision,
      comment: review.comment,
      reviewedAt: review.reviewedAt.toISOString(),
      reviewerNickname: review.reviewerNickname,
    };
  }
}

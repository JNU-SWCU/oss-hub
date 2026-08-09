import type { ReviewDecision } from '@prisma/client';
import type { CreatedMilestoneDocumentReview } from '../milestone-documents.repository';

/**
 * `POST .../applications/:applicationId/reviews` 201 응답.
 *
 * `reviewerNickname`을 싣는 것은 판정이 **쌓이기** 때문이다 — 교직원이 바뀌어도 지난 지적이
 * 남으므로 화면이 「누가 언제 무엇을 지적했는가」를 그릴 수 있어야 한다. 판정자 식별에
 * `reviewerId`(내부 id)를 내보내지 않고 표시용 nickname만 준다.
 */
export class MilestoneDocumentReviewResponseDto {
  id: string;
  decision: ReviewDecision;
  comment: string | null;
  reviewedAt: string;
  reviewerNickname: string;

  private constructor(review: CreatedMilestoneDocumentReview) {
    this.id = review.id;
    this.decision = review.decision;
    this.comment = review.comment;
    this.reviewedAt = review.reviewedAt.toISOString();
    this.reviewerNickname = review.reviewerNickname;
  }

  static from(
    review: CreatedMilestoneDocumentReview,
  ): MilestoneDocumentReviewResponseDto {
    return new MilestoneDocumentReviewResponseDto(review);
  }
}

import { ReviewDecision } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { DomainException } from '../../common/error-code';
import type { CreateMilestoneDocumentReviewInput } from '../domain/milestone-document-review';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from '../milestone-documents-error-code.enum';

/**
 * `POST .../applications/:applicationId/reviews` 요청 본문.
 *
 * 사유 필수 규칙은 옛 제출물 판정
 * (`submission-reviews/dto/create-submission-review-request.dto.ts`)과 같다 —
 * `CHANGES_REQUESTED`·`REJECTED`는 사유가 있어야 하고 `APPROVED`는 선택이다.
 * 공백만 보낸 사유는 `trim()` 후 빈 문자열이 되어 `null`로 접히므로 함께 거부된다
 * (학생 화면에 「사유: (빈칸)」이 남는 것을 막는다).
 */
export class CreateMilestoneDocumentReviewRequestDto {
  @IsEnum(ReviewDecision)
  declare readonly decision: ReviewDecision;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  declare readonly comment?: string;

  toInput(): CreateMilestoneDocumentReviewInput {
    const comment = this.comment?.trim() || null;
    switch (this.decision) {
      case ReviewDecision.APPROVED:
        return { decision: this.decision, comment };
      case ReviewDecision.CHANGES_REQUESTED:
      case ReviewDecision.REJECTED:
        if (comment === null) {
          throw new DomainException(
            MILESTONE_DOCUMENTS_ERROR_CODES[
              MilestoneDocumentsErrorCode.REVIEW_COMMENT_REQUIRED
            ],
          );
        }
        return { decision: this.decision, comment };
    }
  }
}

import { ReviewDecision } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
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
 *
 * **기대 버전 두 값(`expectedSubmittedAt`·`expectedLatestReviewId`)은 선택이 아니다.** 「보내면
 * 검사하고 안 보내면 넘어간다」로 만들면 그 자체가 검사를 우회하는 길이 되어, 지금 고치려는
 * 「보지 못한 내용을 승인한다」가 요청 하나로 되살아난다. 값의 뜻은
 * `domain/milestone-document-review.ts`의 `CreateMilestoneDocumentReviewInput`에 있다.
 */
export class CreateMilestoneDocumentReviewRequestDto {
  @IsEnum(ReviewDecision)
  declare readonly decision: ReviewDecision;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  declare readonly comment?: string;

  /**
   * 수합 표 칸의 `submittedAt`을 그대로 되돌려 보낸다(ISO 8601). 검증 관례는
   * `audit-log/dto/audit-log-query.dto.ts`와 같은 `strict` 조합이다 — 느슨하게 받으면
   * 파싱 결과가 `Invalid Date`가 되어 비교가 언제나 어긋난다(= 항상 409).
   */
  @IsDateString({ strict: true, strictSeparator: true })
  declare readonly expectedSubmittedAt: string;

  /**
   * 칸의 `review.id`. 아직 판정이 없던 칸은 **`null`을 명시해서** 보낸다.
   *
   * `@IsOptional()`이 아니라 `@ValidateIf`인 것이 요점이다 — `IsOptional`은 `null`과 `undefined`를
   * 함께 통과시키므로 필드를 빼먹은 요청도 검사를 건너뛴다. 여기서는 `null`(판정이 없었다)만
   * 허용하고 누락은 400으로 막아야 한다.
   */
  @ValidateIf((_, value) => value !== null)
  @IsString()
  declare readonly expectedLatestReviewId: string | null;

  toInput(): CreateMilestoneDocumentReviewInput {
    const comment = this.comment?.trim() || null;
    const version = {
      expectedSubmittedAt: new Date(this.expectedSubmittedAt),
      expectedLatestReviewId: this.expectedLatestReviewId,
    };
    switch (this.decision) {
      case ReviewDecision.APPROVED:
        return { decision: this.decision, comment, ...version };
      case ReviewDecision.CHANGES_REQUESTED:
      case ReviewDecision.REJECTED:
        if (comment === null) {
          throw new DomainException(
            MILESTONE_DOCUMENTS_ERROR_CODES[
              MilestoneDocumentsErrorCode.REVIEW_COMMENT_REQUIRED
            ],
          );
        }
        return { decision: this.decision, comment, ...version };
    }
  }
}

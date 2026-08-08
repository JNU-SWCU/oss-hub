import { ReviewDecision } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
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
 * **기대 버전 두 값(`expectedRevision`·`expectedLatestReviewId`)은 선택이 아니다.** 「보내면
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
   * 수합 표 칸의 `revision`을 그대로 되돌려 보낸다. 옛 제출물 판정
   * (`submission-reviews/dto/create-submission-review-request.dto.ts`의 `revision`)과 **같은
   * 검증 조합**이다 — 그쪽도 판정을 특정 제출 버전에 묶는 데 이 모양을 쓴다.
   *
   * 시각(`submittedAt`)이 아니라 정수 리비전인 근거는 도메인 타입
   * (`domain/milestone-document-review.ts`)에 있다. `@Min(1)`은 첫 제출이 1이기 때문이며, 0이나
   * 음수가 들어오면 어떤 제출도 가리키지 않아 조용히 409가 되는 대신 400으로 막는다.
   */
  @IsInt()
  @Min(1)
  declare readonly expectedRevision: number;

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
      expectedRevision: this.expectedRevision,
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

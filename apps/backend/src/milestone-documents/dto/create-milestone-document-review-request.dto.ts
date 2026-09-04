import { ReviewDecision } from '@prisma/client';
import {
  IsEnum,
  IsISO8601,
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
   * 보완 요청일 때 **학생이 언제까지 다시 낼 수 있는가**(ISO 8601). 사유와 같은 규칙이다 —
   * `CHANGES_REQUESTED`는 반드시 있어야 하고(없으면 422 MSD_032), 승인·반려는 뜻이 없어
   * 실려 와도 `toInput()`이 떨어뜨린다.
   *
   * `@IsOptional()`인 것은 그 「승인·반려에는 안 보낸다」를 통과시키기 위해서다. **보완 요청의
   * 필수 여부를 데코레이터로 표현하지 않는 것이 의도다** — class-validator의 조건부 검증은
   * 다른 필드 값(`decision`)에 기대는데, 사유 필수 규칙이 이미 `toInput()`의 `switch` 안에
   * 있다. 두 규칙이 서로 다른 자리에 흩어지면 한쪽만 고치는 일이 생긴다.
   *
   * 「지난 시각인가」는 여기서 보지 않는다. 그 비교의 기준은 요청이 도착한 시각이 아니라
   * **판정이 저장되는 시각**이고(잠금을 얻은 뒤에 찍힌다), 그 값은 서비스만 안다
   * (`milestone-document-reviews.service.ts` → 422 MSD_033).
   */
  @IsOptional()
  @IsISO8601()
  declare readonly resubmissionDueAt?: string;

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
        // 승인·반려는 「다시 내라」가 아니라서 기한이 뜻을 갖지 못한다. 실려 왔어도 여기서
        // 떨어뜨린다 — 저장해 두면 나중에 그 값을 보고 「기한이 있는 승인」을 그리게 된다.
        return {
          decision: this.decision,
          comment,
          resubmissionDueAt: null,
          ...version,
        };
      case ReviewDecision.CHANGES_REQUESTED:
      case ReviewDecision.REJECTED: {
        if (comment === null) {
          throw new DomainException(
            MILESTONE_DOCUMENTS_ERROR_CODES[
              MilestoneDocumentsErrorCode.REVIEW_COMMENT_REQUIRED
            ],
          );
        }
        if (this.decision === ReviewDecision.REJECTED) {
          return {
            decision: this.decision,
            comment,
            resubmissionDueAt: null,
            ...version,
          };
        }
        /*
         * 보완 요청에는 기한이 **반드시** 있어야 한다. 없이 통과시키면 「언제까지」를 아무도
         * 말하지 않은 보완 요청이 만들어지고, 학생 화면은 같은 배지 아래에서 어떤 것은
         * 닫히고 어떤 것은 안 닫히게 된다.
         *
         * `Number.isNaN` 검사는 `IsISO8601` **뒤에 서는 두 번째 그물**이다. 지금 계약에서는
         * 데코레이터가 먼저 걸러 여기까지 오는 값이 거의 없지만, `Invalid Date`가 새어
         * 들어오면 시각 비교가 전부 false가 되어 **기한이 영원히 안 지난 것처럼** 행동한다 —
         * 조용히 정책이 꺼지는 모양이라, 값이 아니라 뜻으로 한 번 더 본다.
         */
        const resubmissionDueAt =
          this.resubmissionDueAt === undefined
            ? null
            : new Date(this.resubmissionDueAt);
        if (
          resubmissionDueAt === null ||
          Number.isNaN(resubmissionDueAt.getTime())
        ) {
          throw new DomainException(
            MILESTONE_DOCUMENTS_ERROR_CODES[
              MilestoneDocumentsErrorCode.RESUBMISSION_DUE_AT_REQUIRED
            ],
          );
        }
        return {
          decision: this.decision,
          comment,
          resubmissionDueAt,
          ...version,
        };
      }
    }
  }
}

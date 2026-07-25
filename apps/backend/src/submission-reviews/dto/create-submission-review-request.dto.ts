import { ReviewDecision } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { DomainException } from '../../common/error-code';
import type { CreateSubmissionReviewInput } from '../domain/submission-review';
import {
  SUBMISSION_REVIEWS_ERROR_CODES,
  SubmissionReviewsErrorCode,
} from '../submission-reviews-error-code.enum';

export class CreateSubmissionReviewRequestDto {
  @IsInt()
  @Min(1)
  declare readonly revision: number;

  @IsEnum(ReviewDecision)
  declare readonly decision: ReviewDecision;

  @IsOptional()
  @IsString()
  declare readonly comment?: string;

  toInput(): CreateSubmissionReviewInput {
    const comment = this.comment?.trim() || null;
    switch (this.decision) {
      case ReviewDecision.APPROVED:
        return { revision: this.revision, decision: this.decision, comment };
      case ReviewDecision.CHANGES_REQUESTED:
      case ReviewDecision.REJECTED:
        if (comment === null) {
          throw new DomainException(
            SUBMISSION_REVIEWS_ERROR_CODES[
              SubmissionReviewsErrorCode.COMMENT_REQUIRED
            ],
          );
        }
        return { revision: this.revision, decision: this.decision, comment };
    }
  }
}

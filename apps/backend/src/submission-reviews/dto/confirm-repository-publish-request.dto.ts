import { IsBoolean } from 'class-validator';
import { DomainException } from '../../common/error-code';
import {
  SUBMISSION_REVIEWS_ERROR_CODES,
  SubmissionReviewsErrorCode,
} from '../submission-reviews-error-code.enum';

export class ConfirmRepositoryPublishRequestDto {
  @IsBoolean()
  declare readonly isConfirmed: boolean;

  assertConfirmed(): void {
    if (this.isConfirmed !== true) {
      throw new DomainException(
        SUBMISSION_REVIEWS_ERROR_CODES[
          SubmissionReviewsErrorCode.PUBLISH_CONFIRMATION_REQUIRED
        ],
      );
    }
  }
}

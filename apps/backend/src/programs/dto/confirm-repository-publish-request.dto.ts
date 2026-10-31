import { IsBoolean } from 'class-validator';
import { DomainException } from '../../platform/error-code.error';
import {
  SUBMISSION_REVIEWS_ERROR_CODES,
  SubmissionReviewsErrorCode,
} from '../submission-reviews-error-code.error';

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

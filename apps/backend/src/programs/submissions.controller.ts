import { Controller, Get, Param } from '@nestjs/common';
import { SubmissionReviewContextResponseDto } from './dto/submission-review-context-response.dto';
import { SubmissionReviewsService } from './submission-reviews.service';
import { Protected } from '../auth/auth-route.decorator';
import { STAFF_AUDIENCE } from '../platform/roles.guard';
import { Roles } from '../platform/roles.decorator';
import { DomainException } from '../platform/error-code.error';
import {
  SUBMISSION_REVIEWS_ERROR_CODES,
  SubmissionReviewsErrorCode,
} from './submission-reviews-error-code.error';
const staffApprovalRequired = () =>
  new DomainException(
    SUBMISSION_REVIEWS_ERROR_CODES[
      SubmissionReviewsErrorCode.STAFF_APPROVAL_REQUIRED
    ],
  );
@Controller('submissions')
export class SubmissionsController {
  constructor(private readonly reviewsService: SubmissionReviewsService) {}
  @Get(':submissionId/review-context')
  @Protected()
  @Roles(STAFF_AUDIENCE, staffApprovalRequired)
  async context(
    @Param('submissionId')
    submissionId: string,
  ): Promise<SubmissionReviewContextResponseDto> {
    return SubmissionReviewContextResponseDto.from(
      await this.reviewsService.context(submissionId),
    );
  }
}

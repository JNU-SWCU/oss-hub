import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { OriginGuard } from '../platform/origin.guard';
import { ConfirmRepositoryPublishRequestDto } from './dto/confirm-repository-publish-request.dto';
import { RepositoryPublishResponseDto } from './dto/submission-review-context-response.dto';
import { SubmissionReviewsService } from './submission-reviews.service';
import { Protected } from '../auth/auth-route.decorator';
import { STAFF_AUDIENCE } from '../platform/roles.guard';
import { Roles } from '../platform/roles.decorator';
import { DomainException } from '../platform/error-code.error';
import {
  SUBMISSION_REVIEWS_ERROR_CODES,
  SubmissionReviewsErrorCode,
} from './submission-reviews-error-code.error';

type PublishActorRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

const staffApprovalRequired = () =>
  new DomainException(
    SUBMISSION_REVIEWS_ERROR_CODES[
      SubmissionReviewsErrorCode.STAFF_APPROVAL_REQUIRED
    ],
  );

@Controller('repositories')
@Protected()
export class SubmissionRepositoryPublishingController {
  constructor(private readonly service: SubmissionReviewsService) {}

  @Post(':repositoryId/publish')
  @HttpCode(200)
  @Roles(STAFF_AUDIENCE, staffApprovalRequired)
  @UseGuards(OriginGuard)
  async publish(
    @Req() request: PublishActorRequest,
    @Param('repositoryId') repositoryId: string,
    @Body() body: ConfirmRepositoryPublishRequestDto,
  ): Promise<RepositoryPublishResponseDto> {
    return RepositoryPublishResponseDto.from(
      await this.service.publishRepositoryFromRequest(
        repositoryId,
        request.sessionGithubId,
        body,
      ),
    );
  }
}

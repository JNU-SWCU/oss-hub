import {
  Controller,
  Get,
  Param,
  Header,
  Query,
  Body,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  SubmissionReviewContextResponseDto,
  RepositoryPublishResponseDto,
} from './dto/submission-review-context-response.dto';
import { SubmissionsService } from './submissions.service';
import { Protected } from '../auth/auth-route.decorator';
import { STAFF_AUDIENCE } from '../platform/roles.guard';
import { Roles } from '../platform/roles.decorator';
import { DomainException } from '../platform/error-code.error';
import {
  SUBMISSION_REVIEWS_ERROR_CODES,
  SubmissionReviewsErrorCode,
} from './submission-reviews-error-code.error';
import { SubmissionMatrixRequestDto } from './dto/submission-matrix-request.dto';
import { SubmissionMatrixResponseDto } from './dto/submission-matrix-response.dto';
import { SubmissionMatrixService } from './submission-matrix.service';
import {
  SUBMISSIONS_ERROR_CODES,
  SubmissionsErrorCode,
} from './submissions-error-code.error';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { OriginGuard } from '../platform/origin.guard';
import { ConfirmRepositoryPublishRequestDto } from './dto/confirm-repository-publish-request.dto';
const staffApprovalRequired = () =>
  new DomainException(
    SUBMISSION_REVIEWS_ERROR_CODES[
      SubmissionReviewsErrorCode.STAFF_APPROVAL_REQUIRED
    ],
  );
@Controller('submissions')
export class SubmissionsController {
  constructor(private readonly reviewsService: SubmissionsService) {}
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
const staffOnly = () =>
  new DomainException(SUBMISSIONS_ERROR_CODES[SubmissionsErrorCode.STAFF_ONLY]);
@Controller('programs/:programId/submissions')
export class ProgramSubmissionsController {
  constructor(private readonly matrixService: SubmissionMatrixService) {}
  @Get('matrix')
  @Header('Cache-Control', 'private, no-store')
  @Protected()
  @Roles(STAFF_AUDIENCE, staffOnly)
  async matrix(
    @Param('programId')
    programId: string,
    @Query()
    query: SubmissionMatrixRequestDto,
  ): Promise<SubmissionMatrixResponseDto> {
    const result = await this.matrixService.matrix(programId, query);
    return SubmissionMatrixResponseDto.from(result, programId);
  }
}
type PublishActorRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('repositories')
@Protected()
export class SubmissionRepositoryPublishingController {
  constructor(private readonly service: SubmissionsService) {}

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

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { OriginGuard } from '../platform/origin.guard';
import { CreateSubmissionReviewRequestDto } from './dto/create-submission-review-request.dto';
import {
  CreateSubmissionReviewResponseDto,
  SubmissionReviewContextResponseDto,
} from './dto/submission-review-context-response.dto';
import { SubmissionReviewsService } from './submission-reviews.service';
import {
  CreateResubmissionRequestDto,
  CreateSubmissionRequestDto,
} from './dto/create-submission-request.dto';
import {
  CreatedSubmissionResponseDto,
  ResubmittedSubmissionResponseDto,
} from './dto/submission-form-response.dto';
import { SubmissionsService } from './submissions.service';
import { Protected } from '../auth/auth-route.decorator';
import { STAFF_AUDIENCE } from '../platform/roles.guard';
import { Roles } from '../platform/roles.decorator';
import { DomainException } from '../platform/error-code.error';
import {
  SUBMISSION_REVIEWS_ERROR_CODES,
  SubmissionReviewsErrorCode,
} from './submission-reviews-error-code.error';

type ReviewActorRequest = Pick<AuthenticatedRequest, 'principal'>;

type SubmissionRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

const staffApprovalRequired = () =>
  new DomainException(
    SUBMISSION_REVIEWS_ERROR_CODES[
      SubmissionReviewsErrorCode.STAFF_APPROVAL_REQUIRED
    ],
  );

@Controller('submissions')
export class SubmissionsController {
  constructor(
    private readonly service: SubmissionsService,
    private readonly reviewsService: SubmissionReviewsService,
  ) {}

  @Post()
  @HttpCode(201)
  @Protected()
  @UseGuards(OriginGuard)
  async create(
    @Req() request: SubmissionRequest,
    @Body() body: CreateSubmissionRequestDto,
  ): Promise<CreatedSubmissionResponseDto> {
    return CreatedSubmissionResponseDto.from(
      await this.service.createFromRequest(request.sessionGithubId, body),
    );
  }

  @Post(':submissionId/resubmissions')
  @HttpCode(201)
  @Protected()
  @UseGuards(OriginGuard)
  async resubmit(
    @Req() request: SubmissionRequest,
    @Param('submissionId') submissionId: string,
    @Body() body: CreateResubmissionRequestDto,
  ): Promise<ResubmittedSubmissionResponseDto> {
    return ResubmittedSubmissionResponseDto.from(
      await this.service.resubmitFromRequest(
        request.sessionGithubId,
        submissionId,
        body,
      ),
    );
  }

  @Get(':submissionId/review-context')
  @Protected()
  @Roles(STAFF_AUDIENCE, staffApprovalRequired)
  async context(
    @Param('submissionId') submissionId: string,
  ): Promise<SubmissionReviewContextResponseDto> {
    return SubmissionReviewContextResponseDto.from(
      await this.reviewsService.context(submissionId),
    );
  }

  @Post(':submissionId/reviews')
  @HttpCode(201)
  @Protected()
  @Roles(STAFF_AUDIENCE, staffApprovalRequired)
  @UseGuards(OriginGuard)
  async review(
    @Req() request: ReviewActorRequest,
    @Param('submissionId') submissionId: string,
    @Body() body: CreateSubmissionReviewRequestDto,
  ): Promise<CreateSubmissionReviewResponseDto> {
    return CreateSubmissionReviewResponseDto.from(
      await this.reviewsService.reviewFromRequest(
        request.principal.id,
        submissionId,
        body,
      ),
    );
  }
}

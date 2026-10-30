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
import { OriginGuard } from '../auth/origin.guard';
import { SessionGuard } from '../auth/session.guard';
import { CreateSubmissionReviewRequestDto } from './dto/create-submission-review-request.dto';
import {
  type CreateSubmissionReviewResponseDto,
  type SubmissionReviewContextResponseDto,
  toCreateReviewResponse,
  toReviewContextResponse,
} from './dto/submission-review-response.dto';
import { SubmissionReviewsService } from './submission-reviews.service';
import {
  CreateResubmissionRequestDto,
  CreateSubmissionRequestDto,
} from './dto/create-submission-request.dto';
import {
  presentCreatedSubmission,
  presentResubmittedSubmission,
  type CreatedSubmissionResponseDto,
  type ResubmittedSubmissionResponseDto,
} from './dto/submission-response.dto';
import { SubmissionsService } from './submissions.service';

type ReviewActorRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

type SubmissionRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('submissions')
export class SubmissionsController {
  constructor(
    private readonly service: SubmissionsService,
    private readonly reviewsService: SubmissionReviewsService,
  ) {}

  @Post()
  @HttpCode(201)
  @UseGuards(SessionGuard, OriginGuard)
  create(
    @Req() request: SubmissionRequest,
    @Body() body: CreateSubmissionRequestDto,
  ): Promise<CreatedSubmissionResponseDto> {
    return this.service
      .create(request.sessionGithubId, body.toInput())
      .then(presentCreatedSubmission);
  }

  @Post(':submissionId/resubmissions')
  @HttpCode(201)
  @UseGuards(SessionGuard, OriginGuard)
  resubmit(
    @Req() request: SubmissionRequest,
    @Param('submissionId') submissionId: string,
    @Body() body: CreateResubmissionRequestDto,
  ): Promise<ResubmittedSubmissionResponseDto> {
    return this.service
      .resubmit(request.sessionGithubId, submissionId, body.toInput())
      .then(presentResubmittedSubmission);
  }

  @Get(':submissionId/review-context')
  @UseGuards(SessionGuard)
  async context(
    @Req() request: ReviewActorRequest,
    @Param('submissionId') submissionId: string,
  ): Promise<SubmissionReviewContextResponseDto> {
    return toReviewContextResponse(
      await this.reviewsService.context(submissionId, request.sessionGithubId),
    );
  }

  @Post(':submissionId/reviews')
  @HttpCode(201)
  @UseGuards(SessionGuard, OriginGuard)
  async review(
    @Req() request: ReviewActorRequest,
    @Param('submissionId') submissionId: string,
    @Body() body: CreateSubmissionReviewRequestDto,
  ): Promise<CreateSubmissionReviewResponseDto> {
    return toCreateReviewResponse(
      await this.reviewsService.review(
        request.sessionGithubId,
        submissionId,
        body.toInput(),
      ),
    );
  }
}

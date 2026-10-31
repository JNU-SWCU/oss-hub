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
import { SubmissionInputService } from './submission-input.service';
import { Protected } from '../auth/authentication.guard';

type ReviewActorRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

type SubmissionRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('submissions')
export class SubmissionsController {
  constructor(
    private readonly service: SubmissionsService,
    private readonly reviewsService: SubmissionReviewsService,
    private readonly submissionInputService: SubmissionInputService,
  ) {}

  @Post()
  @HttpCode(201)
  @Protected()
  @UseGuards(OriginGuard)
  create(
    @Req() request: SubmissionRequest,
    @Body() body: CreateSubmissionRequestDto,
  ): Promise<CreatedSubmissionResponseDto> {
    return this.service
      .create(
        request.sessionGithubId,
        this.submissionInputService.toCreateSubmissionInput(body),
      )
      .then((result) => CreatedSubmissionResponseDto.from(result));
  }

  @Post(':submissionId/resubmissions')
  @HttpCode(201)
  @Protected()
  @UseGuards(OriginGuard)
  resubmit(
    @Req() request: SubmissionRequest,
    @Param('submissionId') submissionId: string,
    @Body() body: CreateResubmissionRequestDto,
  ): Promise<ResubmittedSubmissionResponseDto> {
    return this.service
      .resubmit(
        request.sessionGithubId,
        submissionId,
        this.submissionInputService.toResubmitSubmissionInput(body),
      )
      .then((result) => ResubmittedSubmissionResponseDto.from(result));
  }

  @Get(':submissionId/review-context')
  @Protected()
  async context(
    @Req() request: ReviewActorRequest,
    @Param('submissionId') submissionId: string,
  ): Promise<SubmissionReviewContextResponseDto> {
    return SubmissionReviewContextResponseDto.from(
      await this.reviewsService.context(submissionId, request.sessionGithubId),
    );
  }

  @Post(':submissionId/reviews')
  @HttpCode(201)
  @Protected()
  @UseGuards(OriginGuard)
  async review(
    @Req() request: ReviewActorRequest,
    @Param('submissionId') submissionId: string,
    @Body() body: CreateSubmissionReviewRequestDto,
  ): Promise<CreateSubmissionReviewResponseDto> {
    return CreateSubmissionReviewResponseDto.from(
      await this.reviewsService.review(
        request.sessionGithubId,
        submissionId,
        this.reviewsService.reviewInputFromRequest(body),
      ),
    );
  }
}

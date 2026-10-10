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
import type { AuthenticatedRequest } from '../auth/controller/http-auth';
import { OriginGuard } from '../auth/controller/origin.guard';
import { SessionGuard } from '../auth/controller/session.guard';
import { ConfirmRepositoryPublishRequestDto } from './dto/confirm-repository-publish-request.dto';
import { CreateSubmissionReviewRequestDto } from './dto/create-submission-review-request.dto';
import {
  type CreateSubmissionReviewResponseDto,
  type RepositoryPublishResponseDto,
  type SubmissionReviewContextResponseDto,
  toCreateReviewResponse,
  toRepositoryPublishResponse,
  toReviewContextResponse,
} from './dto/submission-review-response.dto';
import { SubmissionReviewsService } from './submission-reviews.service';

type ReviewActorRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

type PublishActorRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('submissions')
@UseGuards(SessionGuard)
export class SubmissionReviewsController {
  constructor(private readonly service: SubmissionReviewsService) {}

  @Get(':submissionId/review-context')
  async context(
    @Req() request: ReviewActorRequest,
    @Param('submissionId') submissionId: string,
  ): Promise<SubmissionReviewContextResponseDto> {
    return toReviewContextResponse(
      await this.service.context(submissionId, request.sessionGithubId),
    );
  }

  @Post(':submissionId/reviews')
  @HttpCode(201)
  @UseGuards(OriginGuard)
  async review(
    @Req() request: ReviewActorRequest,
    @Param('submissionId') submissionId: string,
    @Body() body: CreateSubmissionReviewRequestDto,
  ): Promise<CreateSubmissionReviewResponseDto> {
    return toCreateReviewResponse(
      await this.service.review(
        request.sessionGithubId,
        submissionId,
        body.toInput(),
      ),
    );
  }
}

@Controller('repositories')
@UseGuards(SessionGuard)
export class SubmissionRepositoryPublishingController {
  constructor(private readonly service: SubmissionReviewsService) {}

  @Post(':repositoryId/publish')
  @HttpCode(200)
  @UseGuards(OriginGuard)
  async publish(
    @Req() request: PublishActorRequest,
    @Param('repositoryId') repositoryId: string,
    @Body() body: ConfirmRepositoryPublishRequestDto,
  ): Promise<RepositoryPublishResponseDto> {
    body.assertConfirmed();
    return toRepositoryPublishResponse(
      await this.service.publishRepository(
        repositoryId,
        request.sessionGithubId,
      ),
    );
  }
}

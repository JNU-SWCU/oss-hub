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
import { OriginGuard } from '../auth/origin.guard';
import { SessionGuard } from '../auth/session.guard';
import { CreateSubmissionReviewRequestDto } from './dto/create-submission-review-request.dto';
import {
  type CreateSubmissionReviewResponseDto,
  type RepositoryPublishResponseDto,
  type SubmissionReviewContextResponseDto,
  toCreateReviewResponse,
  toRepositoryPublishResponse,
  toReviewContextResponse,
} from './dto/submission-review-response.dto';
import type { SubmissionReviewStaffRequest } from './submission-reviews-staff.guard';
import { SubmissionReviewsStaffGuard } from './submission-reviews-staff.guard';
import { SubmissionReviewsService } from './submission-reviews.service';

type ReviewActorRequest = Pick<
  SubmissionReviewStaffRequest,
  'submissionReviewerId'
>;

@Controller('submissions')
@UseGuards(SessionGuard, SubmissionReviewsStaffGuard)
export class SubmissionReviewsController {
  constructor(private readonly service: SubmissionReviewsService) {}

  @Get(':submissionId/review-context')
  async context(
    @Param('submissionId') submissionId: string,
  ): Promise<SubmissionReviewContextResponseDto> {
    return toReviewContextResponse(await this.service.context(submissionId));
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
        request.submissionReviewerId,
        submissionId,
        body.toInput(),
      ),
    );
  }
}

@Controller('repositories')
@UseGuards(SessionGuard, SubmissionReviewsStaffGuard)
export class SubmissionRepositoryPublishingController {
  constructor(private readonly service: SubmissionReviewsService) {}

  @Post(':repositoryId/publish')
  @HttpCode(200)
  @UseGuards(OriginGuard)
  async publish(
    @Param('repositoryId') repositoryId: string,
  ): Promise<RepositoryPublishResponseDto> {
    return toRepositoryPublishResponse(
      await this.service.publishRepository(repositoryId),
    );
  }
}

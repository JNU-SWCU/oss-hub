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
import { OriginGuard } from '../auth/origin.guard';
import { SessionGuard } from '../auth/session.guard';
import { ConfirmRepositoryPublishRequestDto } from './dto/confirm-repository-publish-request.dto';
import {
  type RepositoryPublishResponseDto,
  toRepositoryPublishResponse,
} from './dto/submission-review-context-response.dto';
import { SubmissionReviewsService } from './submission-reviews.service';

type PublishActorRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

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

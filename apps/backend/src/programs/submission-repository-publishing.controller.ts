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
import { ConfirmRepositoryPublishRequestDto } from './dto/confirm-repository-publish-request.dto';
import { RepositoryPublishResponseDto } from './dto/submission-review-context-response.dto';
import { SubmissionReviewsService } from './submission-reviews.service';
import { Protected } from '../auth/authentication.guard';

type PublishActorRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('repositories')
@Protected()
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
    this.service.assertPublishConfirmed(body);
    return RepositoryPublishResponseDto.from(
      await this.service.publishRepository(
        repositoryId,
        request.sessionGithubId,
      ),
    );
  }
}

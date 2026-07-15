import { Controller, Post, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { OriginGuard } from '../auth/origin.guard';
import { DomainException } from '../common/error-code';
import {
  COLLECTION_ERROR_CODES,
  CollectionErrorCode,
} from './collection-error-code.enum';
import { CollectionService } from './collection.service';
import { COLLECTION_RUN_STATUSES } from './domain/collection-run';
import { CollectionRunResponseDto } from './dto/collection-run-response.dto';

class MissingRetryTimeError extends Error {
  override readonly name = 'MissingRetryTimeError';

  constructor() {
    super('Rate-limited collection run has no retry time');
  }
}

@Controller('collection-runs')
export class CollectionController {
  constructor(private readonly collectionService: CollectionService) {}

  @Post()
  @UseGuards(SessionGuard, OriginGuard)
  async runSelf(
    @Req() request: AuthenticatedRequest,
  ): Promise<CollectionRunResponseDto> {
    const run = await this.collectionService.runSelf(request.sessionGithubId);
    if (run.status === COLLECTION_RUN_STATUSES.RATE_LIMITED) {
      if (!run.retryNotBeforeAt) {
        throw new MissingRetryTimeError();
      }
      throw new DomainException(
        COLLECTION_ERROR_CODES[CollectionErrorCode.RATE_LIMITED],
        { retryNotBeforeAt: run.retryNotBeforeAt.toISOString() },
      );
    }
    return CollectionRunResponseDto.from(run);
  }
}

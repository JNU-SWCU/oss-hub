import { Controller, HttpCode, Logger, Post, UseGuards } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { OriginGuard } from '../auth/origin.guard';
import { SessionGuard } from '../auth/session.guard';
import { DomainException } from '../common/error-code';
import { CollectionAdminGuard } from './collection-admin.guard';
import { CollectionCutoverRepository } from './collection-cutover.repository';
import {
  COLLECTION_ERROR_CODES,
  CollectionErrorCode,
} from './collection-error-code.enum';
import { CollectionSyncService } from './collection-sync.service';
import { CollectionTriggerResponseDto } from './dto/collection-trigger-response.dto';

/**
 * todo 14 원자 전환: `CollectionSchedulerService`와 동일하게 old writer에서 new writer로
 * 전환됐다 — 두 트리거 표면(cron/관리자 수동 트리거)이 정확히 하나의 writer만 가리킨다.
 */
@Controller('admin/collection')
export class CollectionAdminController {
  private readonly logger = new Logger(CollectionAdminController.name);
  private readonly ownerId = `admin:${randomUUID()}`;

  constructor(
    private readonly sync: CollectionSyncService,
    private readonly cutover: CollectionCutoverRepository,
  ) {}

  @Post('trigger')
  @HttpCode(202)
  @UseGuards(SessionGuard, CollectionAdminGuard, OriginGuard)
  async trigger(): Promise<CollectionTriggerResponseDto> {
    if (await this.cutover.isQuiesced(new Date())) {
      throw new DomainException(
        COLLECTION_ERROR_CODES[CollectionErrorCode.COLLECTION_QUIESCED],
      );
    }
    const runId = randomUUID();
    void this.sync.run(this.ownerId).catch((error: unknown) => {
      this.logger.error({
        event: 'collection.admin.sync_failed',
        runId,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    });
    return new CollectionTriggerResponseDto(runId);
  }
}

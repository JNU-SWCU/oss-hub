import {
  Body,
  Controller,
  HttpCode,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
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
import { CollectionExternalDiscoveryService } from './collection-external-discovery.service';
import { CollectionSyncService } from './collection-sync.service';
import { CollectionExternalDiscoveryRequestDto } from './dto/collection-external-discovery-request.dto';
import { CollectionExternalDiscoveryResponseDto } from './dto/collection-external-discovery-response.dto';
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
    private readonly externalDiscovery: CollectionExternalDiscoveryService,
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
    // Independent void promise — E1 external sweep must not block the org
    // sweep above (separate lease scope, separate failure surface).
    void this.sync.runExternal(this.ownerId).catch((error: unknown) => {
      this.logger.error({
        event: 'collection.admin.external_sync_failed',
        runId,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    });
    return new CollectionTriggerResponseDto(runId);
  }

  /**
   * 학생 1명의 조직 밖 public 저장소를 즉시 탐색·적재한다(E4). 전체 조직
   * 수집(`trigger`)과 달리 GraphQL 호출 1건 규모라 백그라운드로 미루지 않고
   * 요청 안에서 완료해 결과 집계를 그대로 응답한다. 동의 게이트·private
   * 필터는 `CollectionExternalDiscoveryService`가 강제한다 — 이 컨트롤러는
   * 권한(ADMIN 세션)만 확인한다.
   */
  @Post('discover-external')
  @HttpCode(200)
  @UseGuards(SessionGuard, CollectionAdminGuard, OriginGuard)
  async discoverExternal(
    @Body() body: CollectionExternalDiscoveryRequestDto,
  ): Promise<CollectionExternalDiscoveryResponseDto> {
    const result = await this.externalDiscovery.discoverForStudent(
      body.githubLogin,
    );
    return new CollectionExternalDiscoveryResponseDto(
      result.githubLogin,
      result.discoveredCount,
      result.upsertedCount,
      result.skippedOrgProvisionedCount,
    );
  }
}

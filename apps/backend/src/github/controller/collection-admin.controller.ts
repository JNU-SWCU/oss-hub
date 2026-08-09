import {
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { OriginGuard } from '../../auth/origin.guard';
import { SessionGuard, type AuthenticatedRequest } from '../../auth/session.guard';
import {
  COLLECTION_TRIGGER_AUDIT_ACTIONS,
  createCollectionTriggerAuditMetadata,
} from '../../audit-log/audit-log-metadata';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { DomainException } from '../../common/error-code';
import { CollectionAdminGuard } from '../collection-admin.guard';
import { CollectionCutoverRepository } from '../repository/collection-cutover.repository';
import {
  COLLECTION_ERROR_CODES,
  CollectionErrorCode,
} from '../collection-error-code.enum';
import { CollectionExternalDiscoveryService } from '../service/collection-external-discovery.service';
import { CollectionIncrementalRepository } from '../repository/collection-incremental.repository';
import {
  CollectionSyncService,
  type CollectionSyncRunResult,
} from '../service/collection-sync.service';
import { CollectionExternalDiscoveryRequestDto } from '../dto/collection-external-discovery-request.dto';
import { CollectionExternalDiscoveryResponseDto } from '../dto/collection-external-discovery-response.dto';
import { CollectionRunListResponseDto } from '../dto/collection-run-list-response.dto';
import { CollectionTriggerResponseDto } from '../dto/collection-trigger-response.dto';

/** 한 번에 돌려줄 실행 이력 최대 건수 — lease 행이 scope당 1건이라 사실상의 상한이다. */
export const COLLECTION_RUN_LIST_LIMIT = 20;

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
    private readonly incrementalRepository: CollectionIncrementalRepository,
    private readonly auditLog: AuditLogService,
  ) {}

  @Post('trigger')
  @HttpCode(202)
  @UseGuards(SessionGuard, CollectionAdminGuard, OriginGuard)
  async trigger(
    @Req() request: Pick<AuthenticatedRequest, 'sessionGithubId'>,
  ): Promise<CollectionTriggerResponseDto> {
    if (await this.cutover.isQuiesced(new Date())) {
      throw new DomainException(
        COLLECTION_ERROR_CODES[CollectionErrorCode.COLLECTION_QUIESCED],
      );
    }
    // #546 — 이 runId를 그대로 내부 run에 넘긴다. 예전에는 202로 돌려준 값과
    // lease에 박히는 내부 runId가 서로 달라, 관리자가 받은 runId로는 완료·실패를
    // 어디서도 조회할 수 없었다.
    const runId = randomUUID();
    // #547 — actor가 명확한 권한 조작이므로 typed audit을 남긴다. 백그라운드 run을
    // 시작하기 전에 기록해, 감사 기록 없이 수집이 도는 창을 만들지 않는다. 응답 계약
    // (202 + runId)은 그대로다.
    await this.auditLog.record({
      actorGithubId: request.sessionGithubId,
      action: COLLECTION_TRIGGER_AUDIT_ACTIONS.COLLECTION_SYNC_TRIGGERED,
      targetType: 'COLLECTION_SYNC',
      targetId: runId,
      metadata: createCollectionTriggerAuditMetadata({ runId }),
    });
    const startedAt = Date.now();
    this.observeSweep(
      'org',
      runId,
      startedAt,
      this.sync.run(this.ownerId, runId),
    );
    // Independent void promise — E1 external sweep must not block the org
    // sweep above (separate lease scope, separate failure surface).
    this.observeSweep(
      'external',
      runId,
      startedAt,
      this.sync.runExternal(this.ownerId, runId),
    );
    return new CollectionTriggerResponseDto(runId);
  }

  /**
   * #511 — 수동 트리거도 성공 시 로그 1줄을 남긴다. 실패 이벤트만 있던 자리라
   * 관리자가 "내가 누른 수집이 끝났는가"를 로그로 판정할 수 없었다.
   *
   * org·external 두 sweep에 대칭으로 건다 — 한쪽만 남기면 조직 밖 수집의 완료 여부가
   * 다시 판정 불가능해진다. 실패 이벤트 이름은 기존 것을 그대로 유지해 이미 걸려 있는
   * 경보를 깨뜨리지 않는다. 토큰·시크릿·저장소 이름은 담지 않는다(#511 수용 기준).
   */
  private observeSweep(
    scope: 'org' | 'external',
    runId: string,
    startedAt: number,
    sweep: Promise<CollectionSyncRunResult>,
  ): void {
    void sweep.then(
      (result) => {
        this.logger.log({
          event: 'collection.admin.completed',
          scope,
          runId,
          syncStatus: result.status,
          durationMs: Date.now() - startedAt,
          repositoryCount: result.processedRepositoryCount,
          insertedFactCount: result.insertedFactCount,
          inventoryComplete: result.inventoryComplete,
          cycleCompleted: result.cycleCompleted,
          stoppedForBudget: result.stoppedForBudget,
        });
      },
      (error: unknown) => {
        this.logger.error({
          event:
            scope === 'org'
              ? 'collection.admin.sync_failed'
              : 'collection.admin.external_sync_failed',
          scope,
          runId,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
      },
    );
  }

  /**
   * #511 — ADMIN이 DB에 직접 붙지 않고도 sync 실행 결과를 확인할 수 있게 하는 조회 표면.
   * 스키마 무접촉 웨이브라 신규 run 테이블을 만들지 않고 기존 lease/cursor/stream 상태의
   * 프로젝션으로 답한다 — 그래서 돌려주는 것은 **scope별 가장 최근 실행 1건**이다.
   */
  @Get('runs')
  @UseGuards(SessionGuard, CollectionAdminGuard, OriginGuard)
  async listRuns(): Promise<CollectionRunListResponseDto> {
    const runs = await this.incrementalRepository.listSyncRuns(
      new Date(),
      COLLECTION_RUN_LIST_LIMIT,
    );
    return CollectionRunListResponseDto.from(runs);
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

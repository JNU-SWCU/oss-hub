import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';

import { DomainException } from '../common/error-code';
import { PROCESS_RUNTIME_CONFIG } from '../runtime-config/runtime-config.instance';
import { CollectionCutoverRepository } from './collection-cutover.repository';
import {
  COLLECTION_ERROR_CODES,
  CollectionErrorCode,
} from './collection-error-code.enum';
import { CollectionSyncService } from './collection-sync.service';

export const COLLECTION_CRON_JOB_NAME = 'collection-reconciliation';
export const DEFAULT_COLLECTION_CRON_EXPRESSION = '0 0 * * * *';

/**
 * Nest `@Cron` evaluates its expression argument when the class is declared,
 * before DI can inject RUNTIME_CONFIG. 전역 provider와 같은 process snapshot을
 * 사용하되 credential 검증은 기존 reconciliation factory에서 지연한다.
 */
const collectionCronExpression =
  PROCESS_RUNTIME_CONFIG.COLLECTION_CRON_EXPRESSION?.trim() ||
  DEFAULT_COLLECTION_CRON_EXPRESSION;

/**
 * todo 14 원자 전환: 유일하게 배선된 트리거 경로가 old writer(`CollectionReconciliationService`)
 * 에서 new writer(`CollectionSyncService`)로 전환됐다 — old writer는 rollback 용도 코드로만
 * 남는다(ADR-006). `CollectionSyncService.run()`은 완료까지 await하는 동기 호출이라, 기존
 * reconciliation.trigger()와 같은 "즉시 PENDING 반환 + 백그라운드 진행" 계약을 유지하려면
 * fire-and-forget으로 감싼다. `CollectionCutoverLease`가 걸려 있는 동안(todo 14 절차 진행 중)은
 * 트리거를 명시적으로 거부한다 — silent skip이 아니라 별도 에러 코드로 reject한다.
 */
@Injectable()
export class CollectionSchedulerService {
  private readonly logger = new Logger(CollectionSchedulerService.name);
  private readonly ownerId = `scheduler:${randomUUID()}`;

  constructor(
    private readonly sync: CollectionSyncService,
    private readonly cutover: CollectionCutoverRepository,
  ) {}

  @Cron(collectionCronExpression, {
    name: COLLECTION_CRON_JOB_NAME,
    timeZone: 'Asia/Seoul',
    waitForCompletion: true,
  })
  async handleCron(): Promise<void> {
    try {
      await this.trigger();
    } catch (error) {
      this.logger.error({
        event: 'collection.scheduler.failed',
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }

  async trigger(): Promise<{ runId: string; status: 'PENDING' }> {
    if (await this.cutover.isQuiesced(new Date())) {
      throw new DomainException(
        COLLECTION_ERROR_CODES[CollectionErrorCode.COLLECTION_QUIESCED],
      );
    }
    const runId = randomUUID();
    void this.sync.run(this.ownerId).catch((error: unknown) => {
      this.logger.error({
        event: 'collection.scheduler.sync_failed',
        runId,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    });
    // Independent void promise — E1 external sweep must not block the org
    // sweep above (separate lease scope, separate failure surface).
    void this.sync.runExternal(this.ownerId).catch((error: unknown) => {
      this.logger.error({
        event: 'collection.scheduler.external_sync_failed',
        runId,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    });
    return { runId, status: 'PENDING' };
  }
}

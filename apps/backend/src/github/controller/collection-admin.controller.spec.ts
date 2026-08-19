import { Logger } from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';

import { AuditLogService } from '../../audit-log/audit-log.service';
import type { AuditLogRecord } from '../../audit-log/audit-log.repository';
import { OriginGuard } from '../../auth/origin.guard';
import { SessionGuard } from '../../auth/session.guard';
import { ContributionInvariants } from '../contribution-invariants';
import { CollectionAdminController } from './collection-admin.controller';
import { CollectionAdminGuard } from '../collection-admin.guard';
import { CollectionCutoverRepository } from '../repository/collection-cutover.repository';
import { CollectionExternalDiscoveryService } from '../service/collection-external-discovery.service';
import { CollectionIncrementalRepository } from '../repository/collection-incremental.repository';
import type { CollectionSyncRunRow } from '../collection-incremental.types';
import { CollectionSyncService } from '../service/collection-sync.service';
import {
  CollectionUserActivityService,
  type CollectionUserActivitySweepResult,
} from '../service/collection-user-activity.service';

const check = jest.fn();

describe('CollectionAdminController', () => {
  const run = jest.fn<
    Promise<{ runId: string; status: 'COMPLETED' }>,
    [string, string?]
  >();
  const runExternal = jest.fn<
    Promise<{ runId: string; status: 'COMPLETED' }>,
    [string, string?]
  >();
  const isQuiesced = jest.fn<Promise<boolean>, [Date]>();
  const listSyncRuns = jest.fn<
    Promise<CollectionSyncRunRow[]>,
    [Date, number]
  >();
  const discoverForStudent = jest.fn<
    Promise<{
      githubLogin: string;
      discoveredCount: number;
      upsertedCount: number;
      skippedOrgProvisionedCount: number;
    }>,
    [string]
  >();
  const record = jest.fn<Promise<AuditLogRecord>, [unknown]>();
  const runUserActivity = jest.fn<
    Promise<CollectionUserActivitySweepResult>,
    []
  >();
  const sessionRequest = { sessionGithubId: 4242n };

  beforeEach(() => {
    run.mockReset();
    runExternal.mockReset();
    runExternal.mockResolvedValue({
      runId: 'synthetic-external-run-id',
      status: 'COMPLETED',
    });
    isQuiesced.mockReset();
    isQuiesced.mockResolvedValue(false);
    listSyncRuns.mockReset();
    listSyncRuns.mockResolvedValue([]);
    discoverForStudent.mockReset();
    record.mockReset();
    record.mockResolvedValue({} as AuditLogRecord);
    runUserActivity.mockReset();
    runUserActivity.mockResolvedValue({
      observedUserCount: 0,
      upsertedRowCount: 0,
      skippedPastYearCount: 0,
      failedUserCount: 0,
    });
  });

  it('실행을 시작하고 202 응답 DTO를 반환한다', async () => {
    const testingModule = await Test.createTestingModule({
      controllers: [CollectionAdminController],
      providers: [
        { provide: CollectionSyncService, useValue: { run, runExternal } },
        { provide: ContributionInvariants, useValue: { check } },
        { provide: CollectionCutoverRepository, useValue: { isQuiesced } },
        {
          provide: CollectionExternalDiscoveryService,
          useValue: { discoverForStudent },
        },
        {
          provide: CollectionIncrementalRepository,
          useValue: { listSyncRuns },
        },
        { provide: AuditLogService, useValue: { record } },
        {
          provide: CollectionUserActivityService,
          useValue: { run: runUserActivity },
        },
      ],
    })
      .overrideGuard(SessionGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(CollectionAdminGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(OriginGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const controller = testingModule.get(CollectionAdminController);
    run.mockResolvedValue({
      runId: 'synthetic-scheduler-run-id',
      status: 'COMPLETED',
    });

    const result = await controller.trigger(sessionRequest);
    expect(result.status).toBe('PENDING');
    expect(typeof result.runId).toBe('string');
    await testingModule.close();
  });

  it('org sweep과 함께 E1 external sweep도 같은 quiesce guard 안에서 시작한다', async () => {
    run.mockResolvedValue({ runId: 'synthetic-run-id', status: 'COMPLETED' });
    const controller = new CollectionAdminController(
      { run, runExternal } as unknown as CollectionSyncService,
      { isQuiesced } as unknown as CollectionCutoverRepository,
      { discoverForStudent } as unknown as CollectionExternalDiscoveryService,
      { listSyncRuns } as unknown as CollectionIncrementalRepository,
      { record } as unknown as AuditLogService,
      { check } as unknown as ContributionInvariants,
      { run: runUserActivity } as unknown as CollectionUserActivityService,
    );

    await controller.trigger(sessionRequest);

    expect(runExternal).toHaveBeenCalledTimes(1);
    expect(runExternal.mock.calls[0]?.[0]).toMatch(/^admin:/);
    // org sweep과 external sweep은 같은 ownerId를 공유한다(lease scope만 다르다).
    expect(runExternal.mock.calls[0]?.[0]).toBe(run.mock.calls[0]?.[0]);
  });

  it('수동 트리거도 사람 축 sweep을 세 번째로 함께 돌린다', async () => {
    const logger = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    run.mockResolvedValue({ runId: 'synthetic-run-id', status: 'COMPLETED' });
    runUserActivity.mockResolvedValue({
      observedUserCount: 51,
      upsertedRowCount: 51,
      skippedPastYearCount: 0,
      failedUserCount: 0,
    });
    const controller = new CollectionAdminController(
      { run, runExternal } as unknown as CollectionSyncService,
      { isQuiesced } as unknown as CollectionCutoverRepository,
      { discoverForStudent } as unknown as CollectionExternalDiscoveryService,
      { listSyncRuns } as unknown as CollectionIncrementalRepository,
      { record } as unknown as AuditLogService,
      { check } as unknown as ContributionInvariants,
      { run: runUserActivity } as unknown as CollectionUserActivityService,
    );

    await controller.trigger(sessionRequest);
    await new Promise((resolve) => setImmediate(resolve));

    expect(runUserActivity).toHaveBeenCalledTimes(1);
    expect(logger).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'collection.admin.completed',
        scope: 'person',
        observedUserCount: 51,
        upsertedRowCount: 51,
      }),
    );
    logger.mockRestore();
  });

  it('사람 축 sweep 실패는 별도 이벤트로만 기록되고 org sweep을 막지 않는다', async () => {
    const logger = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    run.mockResolvedValue({ runId: 'synthetic-run-id', status: 'COMPLETED' });
    runUserActivity.mockRejectedValue(new Error('person sweep unavailable'));
    const controller = new CollectionAdminController(
      { run, runExternal } as unknown as CollectionSyncService,
      { isQuiesced } as unknown as CollectionCutoverRepository,
      { discoverForStudent } as unknown as CollectionExternalDiscoveryService,
      { listSyncRuns } as unknown as CollectionIncrementalRepository,
      { record } as unknown as AuditLogService,
      { check } as unknown as ContributionInvariants,
      { run: runUserActivity } as unknown as CollectionUserActivityService,
    );

    await expect(controller.trigger(sessionRequest)).resolves.toEqual(
      expect.objectContaining({ status: 'PENDING' }),
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(run).toHaveBeenCalledTimes(1);
    expect(logger).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'collection.admin.person_sync_failed',
        scope: 'person',
      }),
    );
    logger.mockRestore();
  });

  it('quiesce lease가 걸려 있으면 COL_008을 던지고 새 writer를 호출하지 않는다', async () => {
    isQuiesced.mockResolvedValue(true);
    const controller = new CollectionAdminController(
      { run, runExternal } as unknown as CollectionSyncService,
      { isQuiesced } as unknown as CollectionCutoverRepository,
      { discoverForStudent } as unknown as CollectionExternalDiscoveryService,
      { listSyncRuns } as unknown as CollectionIncrementalRepository,
      { record } as unknown as AuditLogService,
      { check } as unknown as ContributionInvariants,
      { run: runUserActivity } as unknown as CollectionUserActivityService,
    );

    await expect(controller.trigger(sessionRequest)).rejects.toMatchObject({
      errorCode: { code: 'COL_008', status: 409 },
    });
    expect(run).not.toHaveBeenCalled();
    expect(runExternal).not.toHaveBeenCalled();
  });

  it('백그라운드 external sweep 실패는 트리거 응답이나 org sweep에 영향을 주지 않고 별도 이벤트로 기록된다', async () => {
    const logger = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    run.mockResolvedValue({ runId: 'synthetic-run-id', status: 'COMPLETED' });
    runExternal.mockRejectedValue(new Error('external provider unavailable'));
    const controller = new CollectionAdminController(
      { run, runExternal } as unknown as CollectionSyncService,
      { isQuiesced } as unknown as CollectionCutoverRepository,
      { discoverForStudent } as unknown as CollectionExternalDiscoveryService,
      { listSyncRuns } as unknown as CollectionIncrementalRepository,
      { record } as unknown as AuditLogService,
      { check } as unknown as ContributionInvariants,
      { run: runUserActivity } as unknown as CollectionUserActivityService,
    );

    const result = await controller.trigger(sessionRequest);
    expect(result.status).toBe('PENDING');
    await new Promise((resolve) => setImmediate(resolve));

    expect(run).toHaveBeenCalledTimes(1);
    expect(logger).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'collection.admin.external_sync_failed',
      }),
    );
    expect(logger).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: 'collection.admin.sync_failed' }),
    );
  });

  it('세션, ADMIN 역할, origin 순서로 보호하고 HTTP 202를 선언한다', () => {
    const handler: unknown = Object.getOwnPropertyDescriptor(
      CollectionAdminController.prototype,
      'trigger',
    )?.value;
    expect(typeof handler).toBe('function');
    if (typeof handler !== 'function') {
      return;
    }
    const guards: unknown = Reflect.getMetadata(GUARDS_METADATA, handler);
    const statusCode: unknown = Reflect.getMetadata(
      HTTP_CODE_METADATA,
      handler,
    );

    expect(guards).toEqual([SessionGuard, CollectionAdminGuard, OriginGuard]);
    expect(statusCode).toBe(202);
  });

  it('학생 GitHub login으로 외부 discovery를 호출하고 집계 결과를 200으로 반환한다', async () => {
    discoverForStudent.mockResolvedValue({
      githubLogin: 'octocat',
      discoveredCount: 3,
      upsertedCount: 2,
      skippedOrgProvisionedCount: 1,
    });
    const controller = new CollectionAdminController(
      { run, runExternal } as unknown as CollectionSyncService,
      { isQuiesced } as unknown as CollectionCutoverRepository,
      { discoverForStudent } as unknown as CollectionExternalDiscoveryService,
      { listSyncRuns } as unknown as CollectionIncrementalRepository,
      { record } as unknown as AuditLogService,
      { check } as unknown as ContributionInvariants,
      { run: runUserActivity } as unknown as CollectionUserActivityService,
    );

    const result = await controller.discoverExternal({
      githubLogin: 'octocat',
    });

    expect(discoverForStudent).toHaveBeenCalledWith('octocat');
    expect(result.status).toBe('COMPLETED');
    expect(result.githubLogin).toBe('octocat');
    expect(result.discoveredCount).toBe(3);
    expect(result.upsertedCount).toBe(2);
    expect(result.skippedOrgProvisionedCount).toBe(1);
  });

  it('discover-external은 세션, ADMIN 역할, origin 순서로 보호하고 HTTP 200을 선언한다', () => {
    const handler: unknown = Object.getOwnPropertyDescriptor(
      CollectionAdminController.prototype,
      'discoverExternal',
    )?.value;
    expect(typeof handler).toBe('function');
    if (typeof handler !== 'function') {
      return;
    }
    const guards: unknown = Reflect.getMetadata(GUARDS_METADATA, handler);
    const statusCode: unknown = Reflect.getMetadata(
      HTTP_CODE_METADATA,
      handler,
    );

    expect(guards).toEqual([SessionGuard, CollectionAdminGuard, OriginGuard]);
    expect(statusCode).toBe(200);
  });

  // #546 — 202로 돌려준 runId와 내부 run의 runId가 달라 조회가 불가능했다.
  it('202로 돌려준 runId를 그대로 내부 sync run에 넘긴다', async () => {
    run.mockResolvedValue({ runId: 'ignored', status: 'COMPLETED' });
    const controller = new CollectionAdminController(
      { run, runExternal } as unknown as CollectionSyncService,
      { isQuiesced } as unknown as CollectionCutoverRepository,
      { discoverForStudent } as unknown as CollectionExternalDiscoveryService,
      { listSyncRuns } as unknown as CollectionIncrementalRepository,
      { record } as unknown as AuditLogService,
      { check } as unknown as ContributionInvariants,
      { run: runUserActivity } as unknown as CollectionUserActivityService,
    );

    const response = await controller.trigger(sessionRequest);
    await new Promise((resolve) => setImmediate(resolve));

    expect(run).toHaveBeenCalledWith(expect.any(String), response.runId);
  });

  // #547 — actor가 명확한 권한 조작인데 AuditLog에 typed action 기록이 없었다.
  it('트리거를 typed audit action으로 기록한다(응답 계약은 그대로)', async () => {
    run.mockResolvedValue({ runId: 'ignored', status: 'COMPLETED' });
    const controller = new CollectionAdminController(
      { run, runExternal } as unknown as CollectionSyncService,
      { isQuiesced } as unknown as CollectionCutoverRepository,
      { discoverForStudent } as unknown as CollectionExternalDiscoveryService,
      { listSyncRuns } as unknown as CollectionIncrementalRepository,
      { record } as unknown as AuditLogService,
      { check } as unknown as ContributionInvariants,
      { run: runUserActivity } as unknown as CollectionUserActivityService,
    );

    const response = await controller.trigger(sessionRequest);

    expect(record).toHaveBeenCalledWith({
      actorGithubId: 4242n,
      action: 'COLLECTION_SYNC_TRIGGERED',
      targetType: 'COLLECTION_SYNC',
      targetId: response.runId,
      metadata: { schemaVersion: 1, runId: response.runId },
    });
    expect(response.status).toBe('PENDING');
  });

  it('quiesce로 거부된 트리거는 감사 기록을 남기지 않는다', async () => {
    isQuiesced.mockResolvedValue(true);
    const controller = new CollectionAdminController(
      { run, runExternal } as unknown as CollectionSyncService,
      { isQuiesced } as unknown as CollectionCutoverRepository,
      { discoverForStudent } as unknown as CollectionExternalDiscoveryService,
      { listSyncRuns } as unknown as CollectionIncrementalRepository,
      { record } as unknown as AuditLogService,
      { check } as unknown as ContributionInvariants,
      { run: runUserActivity } as unknown as CollectionUserActivityService,
    );

    await expect(controller.trigger(sessionRequest)).rejects.toBeDefined();

    expect(record).not.toHaveBeenCalled();
  });

  // #511 — ADMIN이 DB에 직접 붙지 않고 실행 이력을 볼 수 있어야 한다.
  it('runs는 sync 실행 이력 프로젝션을 ISO 문자열 응답으로 변환한다', async () => {
    listSyncRuns.mockResolvedValue([
      {
        runId: 'run-1',
        scope: 'org:jnu-swcu',
        trigger: 'CRON',
        status: 'COMPLETED',
        startedAt: new Date('2026-08-04T00:00:00.000Z'),
        lastObservedAt: new Date('2026-08-04T00:05:00.000Z'),
        cycleCompletedAt: new Date('2026-08-04T00:04:30.000Z'),
        streams: {
          readyCount: 27,
          backfillingCount: 0,
          pendingCount: 0,
          verifyingCount: 0,
          failedCount: 0,
        },
        errorCodes: [],
      },
    ]);
    const controller = new CollectionAdminController(
      { run, runExternal } as unknown as CollectionSyncService,
      { isQuiesced } as unknown as CollectionCutoverRepository,
      { discoverForStudent } as unknown as CollectionExternalDiscoveryService,
      { listSyncRuns } as unknown as CollectionIncrementalRepository,
      { record } as unknown as AuditLogService,
      { check } as unknown as ContributionInvariants,
      { run: runUserActivity } as unknown as CollectionUserActivityService,
    );

    const result = await controller.listRuns();

    expect(listSyncRuns).toHaveBeenCalledWith(expect.any(Date), 20);
    expect(result.runs).toEqual([
      {
        runId: 'run-1',
        scope: 'org:jnu-swcu',
        trigger: 'CRON',
        status: 'COMPLETED',
        startedAt: '2026-08-04T00:00:00.000Z',
        lastObservedAt: '2026-08-04T00:05:00.000Z',
        cycleCompletedAt: '2026-08-04T00:04:30.000Z',
        streams: {
          ready: 27,
          backfilling: 0,
          pending: 0,
          verifying: 0,
          failed: 0,
        },
        errorCodes: [],
      },
    ]);
  });

  it('runs 응답에는 lease ownerId 등 자격증명 계열 값이 담기지 않는다', async () => {
    listSyncRuns.mockResolvedValue([
      {
        runId: 'run-1',
        scope: 'external',
        trigger: 'MANUAL',
        status: 'RUNNING',
        startedAt: null,
        lastObservedAt: new Date('2026-08-04T00:05:00.000Z'),
        cycleCompletedAt: null,
        streams: {
          readyCount: 0,
          backfillingCount: 0,
          pendingCount: 3,
          verifyingCount: 0,
          failedCount: 0,
        },
        errorCodes: [],
      },
    ]);
    const controller = new CollectionAdminController(
      { run, runExternal } as unknown as CollectionSyncService,
      { isQuiesced } as unknown as CollectionCutoverRepository,
      { discoverForStudent } as unknown as CollectionExternalDiscoveryService,
      { listSyncRuns } as unknown as CollectionIncrementalRepository,
      { record } as unknown as AuditLogService,
      { check } as unknown as ContributionInvariants,
      { run: runUserActivity } as unknown as CollectionUserActivityService,
    );

    const serialized = JSON.stringify(await controller.listRuns());

    expect(serialized).not.toContain('ownerId');
    expect(serialized).not.toContain('admin:');
    expect(serialized).not.toContain('token');
  });

  it('runs는 세션, ADMIN 역할, origin 순서로 보호한다', () => {
    const handler: unknown = Object.getOwnPropertyDescriptor(
      CollectionAdminController.prototype,
      'listRuns',
    )?.value;
    expect(typeof handler).toBe('function');
    if (typeof handler !== 'function') {
      return;
    }
    const guards: unknown = Reflect.getMetadata(GUARDS_METADATA, handler);

    expect(guards).toEqual([SessionGuard, CollectionAdminGuard, OriginGuard]);
  });
});

/**
 * 불변식 전수 검사 endpoint (ADR-010 §11).
 *
 * ADR이 "기계로 전수 검사한다"고 약속했는데 호출자가 없으면 그 약속은 죽은 코드다.
 * 이 endpoint가 그 실행 경로이며, 여기서 보는 것은 두 가지다 —
 * read-only 인가, 그리고 응답이 식별자를 흘리지 않는가.
 */
describe('CollectionAdminController — 기여 불변식 검사', () => {
  it('검사 결과를 그대로 돌려준다 — 고치지 않는다', async () => {
    const report = {
      checkedAt: new Date('2026-08-09T00:00:00.000Z'),
      ok: false,
      results: [
        {
          name: '가입자만 적재',
          ok: false,
          violationCount: 2,
          detail: '가입자 아닌 기여자 2명 — 적재 필터가 열려 있다',
        },
      ],
    };
    const checkInvariants = jest.fn().mockResolvedValue(report);
    const controller = new CollectionAdminController(
      {} as unknown as CollectionSyncService,
      {} as unknown as CollectionCutoverRepository,
      {} as unknown as CollectionExternalDiscoveryService,
      {} as unknown as CollectionIncrementalRepository,
      {} as unknown as AuditLogService,
      { check: checkInvariants } as unknown as ContributionInvariants,
      {} as unknown as CollectionUserActivityService,
    );

    await expect(controller.checkInvariants()).resolves.toEqual(report);
    expect(checkInvariants).toHaveBeenCalledTimes(1);
  });

  it('응답에 학생 식별자나 저장소 이름이 없다', async () => {
    const checkInvariants = jest.fn().mockResolvedValue({
      checkedAt: new Date('2026-08-09T00:00:00.000Z'),
      ok: false,
      results: [
        {
          name: '가입자만 적재',
          ok: false,
          violationCount: 1,
          detail: '가입자 아닌 기여자 1명 — 적재 필터가 열려 있다',
        },
      ],
    });
    const controller = new CollectionAdminController(
      {} as unknown as CollectionSyncService,
      {} as unknown as CollectionCutoverRepository,
      {} as unknown as CollectionExternalDiscoveryService,
      {} as unknown as CollectionIncrementalRepository,
      {} as unknown as AuditLogService,
      { check: checkInvariants } as unknown as ContributionInvariants,
      {} as unknown as CollectionUserActivityService,
    );

    const serialized = JSON.stringify(await controller.checkInvariants());
    // ADMIN 전용이라도 조직 내부 정보다. 이 값이 로그·이슈로 옮겨질 수 있다.
    expect(serialized).not.toMatch(/githubId|githubLogin|nameWithOwner/u);
  });
});

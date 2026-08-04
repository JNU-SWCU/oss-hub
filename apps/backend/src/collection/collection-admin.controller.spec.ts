import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';

import { OriginGuard } from '../auth/origin.guard';
import { SessionGuard } from '../auth/session.guard';
import { CollectionAdminController } from './collection-admin.controller';
import { CollectionAdminGuard } from './collection-admin.guard';
import { CollectionCutoverRepository } from './collection-cutover.repository';
import { CollectionExternalDiscoveryService } from './collection-external-discovery.service';
import { CollectionIncrementalRepository } from './collection-incremental.repository';
import type { CollectionSyncRunRow } from './collection-incremental.types';
import { CollectionSyncService } from './collection-sync.service';

describe('CollectionAdminController', () => {
  const run = jest.fn<
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

  beforeEach(() => {
    run.mockReset();
    isQuiesced.mockReset();
    isQuiesced.mockResolvedValue(false);
    listSyncRuns.mockReset();
    listSyncRuns.mockResolvedValue([]);
    discoverForStudent.mockReset();
  });

  it('실행을 시작하고 202 응답 DTO를 반환한다', async () => {
    const testingModule = await Test.createTestingModule({
      controllers: [CollectionAdminController],
      providers: [
        { provide: CollectionSyncService, useValue: { run } },
        { provide: CollectionCutoverRepository, useValue: { isQuiesced } },
        {
          provide: CollectionExternalDiscoveryService,
          useValue: { discoverForStudent },
        },
        {
          provide: CollectionIncrementalRepository,
          useValue: { listSyncRuns },
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

    const result = await controller.trigger();
    expect(result.status).toBe('PENDING');
    expect(typeof result.runId).toBe('string');
    await testingModule.close();
  });

  it('quiesce lease가 걸려 있으면 COL_008을 던지고 새 writer를 호출하지 않는다', async () => {
    isQuiesced.mockResolvedValue(true);
    const controller = new CollectionAdminController(
      { run } as unknown as CollectionSyncService,
      { isQuiesced } as unknown as CollectionCutoverRepository,
      { discoverForStudent } as unknown as CollectionExternalDiscoveryService,
      { listSyncRuns } as unknown as CollectionIncrementalRepository,
    );

    await expect(controller.trigger()).rejects.toMatchObject({
      errorCode: { code: 'COL_008', status: 409 },
    });
    expect(run).not.toHaveBeenCalled();
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
      { run } as unknown as CollectionSyncService,
      { isQuiesced } as unknown as CollectionCutoverRepository,
      { discoverForStudent } as unknown as CollectionExternalDiscoveryService,
      { listSyncRuns } as unknown as CollectionIncrementalRepository,
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
      { run } as unknown as CollectionSyncService,
      { isQuiesced } as unknown as CollectionCutoverRepository,
      { discoverForStudent } as unknown as CollectionExternalDiscoveryService,
      { listSyncRuns } as unknown as CollectionIncrementalRepository,
    );

    const response = await controller.trigger();
    await new Promise((resolve) => setImmediate(resolve));

    expect(run).toHaveBeenCalledWith(expect.any(String), response.runId);
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
      { run } as unknown as CollectionSyncService,
      { isQuiesced } as unknown as CollectionCutoverRepository,
      { discoverForStudent } as unknown as CollectionExternalDiscoveryService,
      { listSyncRuns } as unknown as CollectionIncrementalRepository,
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
      { run } as unknown as CollectionSyncService,
      { isQuiesced } as unknown as CollectionCutoverRepository,
      { discoverForStudent } as unknown as CollectionExternalDiscoveryService,
      { listSyncRuns } as unknown as CollectionIncrementalRepository,
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

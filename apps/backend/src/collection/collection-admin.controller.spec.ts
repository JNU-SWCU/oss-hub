import { Logger } from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';

import { OriginGuard } from '../auth/origin.guard';
import { SessionGuard } from '../auth/session.guard';
import { CollectionAdminController } from './collection-admin.controller';
import { CollectionAdminGuard } from './collection-admin.guard';
import { CollectionCutoverRepository } from './collection-cutover.repository';
import { CollectionExternalDiscoveryService } from './collection-external-discovery.service';
import { CollectionSyncService } from './collection-sync.service';

describe('CollectionAdminController', () => {
  const run = jest.fn<
    Promise<{ runId: string; status: 'COMPLETED' }>,
    [string]
  >();
  const runExternal = jest.fn<
    Promise<{ runId: string; status: 'COMPLETED' }>,
    [string]
  >();
  const isQuiesced = jest.fn<Promise<boolean>, [Date]>();
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
    runExternal.mockReset();
    runExternal.mockResolvedValue({
      runId: 'synthetic-external-run-id',
      status: 'COMPLETED',
    });
    isQuiesced.mockReset();
    isQuiesced.mockResolvedValue(false);
    discoverForStudent.mockReset();
  });

  it('실행을 시작하고 202 응답 DTO를 반환한다', async () => {
    const testingModule = await Test.createTestingModule({
      controllers: [CollectionAdminController],
      providers: [
        { provide: CollectionSyncService, useValue: { run, runExternal } },
        { provide: CollectionCutoverRepository, useValue: { isQuiesced } },
        {
          provide: CollectionExternalDiscoveryService,
          useValue: { discoverForStudent },
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

  it('org sweep과 함께 E1 external sweep도 같은 quiesce guard 안에서 시작한다', async () => {
    run.mockResolvedValue({ runId: 'synthetic-run-id', status: 'COMPLETED' });
    const controller = new CollectionAdminController(
      { run, runExternal } as unknown as CollectionSyncService,
      { isQuiesced } as unknown as CollectionCutoverRepository,
      { discoverForStudent } as unknown as CollectionExternalDiscoveryService,
    );

    await controller.trigger();

    expect(runExternal).toHaveBeenCalledTimes(1);
    expect(runExternal.mock.calls[0]?.[0]).toMatch(/^admin:/);
    // org sweep과 external sweep은 같은 ownerId를 공유한다(lease scope만 다르다).
    expect(runExternal.mock.calls[0]?.[0]).toBe(run.mock.calls[0]?.[0]);
  });

  it('quiesce lease가 걸려 있으면 COL_008을 던지고 새 writer를 호출하지 않는다', async () => {
    isQuiesced.mockResolvedValue(true);
    const controller = new CollectionAdminController(
      { run, runExternal } as unknown as CollectionSyncService,
      { isQuiesced } as unknown as CollectionCutoverRepository,
      { discoverForStudent } as unknown as CollectionExternalDiscoveryService,
    );

    await expect(controller.trigger()).rejects.toMatchObject({
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
    );

    const result = await controller.trigger();
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
      { run } as unknown as CollectionSyncService,
      { isQuiesced } as unknown as CollectionCutoverRepository,
      { discoverForStudent } as unknown as CollectionExternalDiscoveryService,
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
});

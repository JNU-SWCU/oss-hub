import { BadRequestException, Logger, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';

import { OriginGuard } from '../platform/origin.guard';
import { RolesGuard } from '../platform/roles.guard';
import { CollectionAdminController } from './collection-admin.controller';
import { CollectionTriggerRequestDto } from './dto/collection-trigger-request.dto';
import { CollectionAdminService } from '../github/collection-admin.service';
import {
  CollectionSyncService,
  type CollectionRunKind,
} from '../github/collection-sync.service';
import {
  CollectionUserActivityService,
  type CollectionUserActivitySweepResult,
} from '../github/collection-user-activity.service';

function createController(
  sync: CollectionSyncService,
  activity: CollectionUserActivityService,
): CollectionAdminController {
  return new CollectionAdminController(
    new CollectionAdminService(sync, activity),
  );
}

describe('CollectionAdminController', () => {
  const run = jest.fn<
    Promise<{ runId: string; status: 'COMPLETED' }>,
    [string, string?, CollectionRunKind?]
  >();
  const runExternal = jest.fn<
    Promise<{ runId: string; status: 'COMPLETED' }>,
    [string, string?, CollectionRunKind?]
  >();
  const runUserActivity = jest.fn<
    Promise<CollectionUserActivitySweepResult>,
    []
  >();

  beforeEach(() => {
    run.mockReset();
    runExternal.mockReset();
    runExternal.mockResolvedValue({
      runId: 'synthetic-external-run-id',
      status: 'COMPLETED',
    });
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
        CollectionAdminService,
        { provide: CollectionSyncService, useValue: { run, runExternal } },
        {
          provide: CollectionUserActivityService,
          useValue: { run: runUserActivity },
        },
      ],
    })
      .overrideGuard(OriginGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const controller = testingModule.get(CollectionAdminController);
    run.mockResolvedValue({
      runId: 'synthetic-scheduler-run-id',
      status: 'COMPLETED',
    });

    const result = await controller.trigger({});
    expect(result.status).toBe('PENDING');
    expect(typeof result.runId).toBe('string');
    await testingModule.close();
  });

  it('org sweep과 함께 E1 external sweep도 시작한다', async () => {
    run.mockResolvedValue({ runId: 'synthetic-run-id', status: 'COMPLETED' });
    const controller = createController(
      { run, runExternal } as unknown as CollectionSyncService,
      { run: runUserActivity } as unknown as CollectionUserActivityService,
    );

    await controller.trigger({});

    expect(runExternal).toHaveBeenCalledTimes(1);
    expect(runExternal.mock.calls[0]?.[0]).toMatch(/^admin:/);

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
    const controller = createController(
      { run, runExternal } as unknown as CollectionSyncService,
      { run: runUserActivity } as unknown as CollectionUserActivityService,
    );

    await controller.trigger({});
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
    const controller = createController(
      { run, runExternal } as unknown as CollectionSyncService,
      { run: runUserActivity } as unknown as CollectionUserActivityService,
    );

    await expect(controller.trigger({})).resolves.toEqual(
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

  it('백그라운드 external sweep 실패는 트리거 응답이나 org sweep에 영향을 주지 않고 별도 이벤트로 기록된다', async () => {
    const logger = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    run.mockResolvedValue({ runId: 'synthetic-run-id', status: 'COMPLETED' });
    runExternal.mockRejectedValue(new Error('external provider unavailable'));
    const controller = createController(
      { run, runExternal } as unknown as CollectionSyncService,
      { run: runUserActivity } as unknown as CollectionUserActivityService,
    );

    const result = await controller.trigger({});
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

  it('세션과 origin guard를 유지하고 HTTP 202를 선언한다', () => {
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

    expect(guards).toEqual([OriginGuard, RolesGuard]);
    expect(statusCode).toBe(202);
  });

  it('202로 돌려준 runId를 그대로 내부 sync run에 넘긴다', async () => {
    run.mockResolvedValue({ runId: 'ignored', status: 'COMPLETED' });
    const controller = createController(
      { run, runExternal } as unknown as CollectionSyncService,
      { run: runUserActivity } as unknown as CollectionUserActivityService,
    );

    const response = await controller.trigger({});
    await new Promise((resolve) => setImmediate(resolve));

    expect(run).toHaveBeenCalledWith(
      expect.any(String),
      response.runId,
      'hourly',
    );
    expect(runExternal).toHaveBeenCalledWith(
      expect.any(String),
      response.runId,
      'hourly',
    );
  });

  it('fullScan: true면 조직과 외부 sweep을 since 없는 전체 읽기로 시작한다', async () => {
    run.mockResolvedValue({ runId: 'ignored', status: 'COMPLETED' });
    const controller = createController(
      { run, runExternal } as unknown as CollectionSyncService,
      { run: runUserActivity } as unknown as CollectionUserActivityService,
    );

    const response = await controller.trigger({ fullScan: true });
    await new Promise((resolve) => setImmediate(resolve));

    expect(run).toHaveBeenCalledWith(
      expect.any(String),
      response.runId,
      'full',
    );
    expect(runExternal).toHaveBeenCalledWith(
      expect.any(String),
      response.runId,
      'full',
    );
  });

  it('fullScan은 boolean만 받고 모르는 필드는 거절한다', async () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    const metadata = {
      type: 'body' as const,
      metatype: CollectionTriggerRequestDto,
    };

    await expect(pipe.transform({ fullScan: true }, metadata)).resolves.toEqual(
      { fullScan: true },
    );
    await expect(pipe.transform({}, metadata)).resolves.toEqual({});
    await expect(
      pipe.transform({ fullScan: 'yes' }, metadata),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      pipe.transform({ since: '2026-01-01' }, metadata),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('트리거의 응답 계약은 그대로 유지한다', async () => {
    run.mockResolvedValue({ runId: 'ignored', status: 'COMPLETED' });
    const controller = createController(
      { run, runExternal } as unknown as CollectionSyncService,
      { run: runUserActivity } as unknown as CollectionUserActivityService,
    );

    const response = await controller.trigger({});

    expect(typeof response.runId).toBe('string');
    expect(response.status).toBe('PENDING');
  });
});

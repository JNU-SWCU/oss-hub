import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { SessionGuard, type AuthenticatedRequest } from '../auth/session.guard';
import { SystemStatusController } from './system-status.controller';
import { SystemStatusService } from './system-status.service';

describe('SystemStatusController', () => {
  it('세션의 githubId로 서비스를 호출하고 DTO를 그대로 반환한다', async () => {
    const dto = {
      collection: {
        health: 'NORMAL' as const,
        dataAsOf: '2026-07-25T11:00:00.000Z',
        trackedRepositoryCount: 2,
        readyStreamCount: 6,
        backfillingStreamCount: 0,
        partialStreamCount: 0,
        retryPendingStreamCount: 0,
        oldestReadyCheckpointAt: '2026-07-25T10:00:00.000Z',
        oldestRetryPendingAt: null,
        lastCycleStartedAt: '2026-07-25T10:55:00.000Z',
        lastCycleCompletedAt: '2026-07-25T11:00:00.000Z',
        nextCycleAt: '2026-07-25T20:30:00.000Z',
        currentRunStatus: 'IDLE' as const,
        safeReason: null,
      },
      repositoryProvisioning: {
        finalFailureCount: 0,
      },
      collectionStreams: [
        {
          repositoryName: 'JNU-SWCU/alpha',
          streams: [
            {
              streamType: 'COMMIT' as const,
              bucket: 'READY' as const,
              lastSuccessAt: '2026-07-25T10:00:00.000Z',
              lastErrorCode: null,
              lastErrorAt: null,
            },
          ],
        },
      ],
    };
    const getStatus = jest.fn<
      ReturnType<SystemStatusService['getStatus']>,
      [bigint]
    >();
    getStatus.mockResolvedValue(dto);
    const testingModule = await Test.createTestingModule({
      controllers: [SystemStatusController],
      providers: [{ provide: SystemStatusService, useValue: { getStatus } }],
    })
      .overrideGuard(SessionGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const controller = testingModule.get(SystemStatusController);

    await expect(
      controller.getStatus({ sessionGithubId: 133n } as AuthenticatedRequest),
    ).resolves.toBe(dto);
    expect(getStatus).toHaveBeenCalledWith(133n);
    await testingModule.close();
  });

  it('GET /system-status를 SessionGuard로 보호한다', () => {
    const handler: unknown = Object.getOwnPropertyDescriptor(
      SystemStatusController.prototype,
      'getStatus',
    )?.value;
    expect(typeof handler).toBe('function');
    if (typeof handler !== 'function') {
      throw new Error('SystemStatusController.getStatus handler is missing');
    }
    expect(Reflect.getMetadata(PATH_METADATA, SystemStatusController)).toBe(
      'system-status',
    );
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('/');
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([
      SessionGuard,
    ]);
  });
});

import { ForbiddenException } from '@nestjs/common';
import { AccountStatus, Role } from '@prisma/client';
import type {
  CollectionIncrementalStatusSnapshotDto,
  CollectionRepositoryStreamsDto,
} from '../github/collection-read.port';
import { SystemStatusRepository } from './system-status.repository';
import { SystemStatusService } from './system-status.service';

const NOW = new Date('2026-07-25T12:00:00.000Z');
const ACTOR_ID = 133n;
/** 매일 KST 05:30:00 — 손으로 계산 가능한 다음 발생 시각을 갖도록 고른 고정 표현식. */
const DAILY_0530_KST_CRON = '0 30 5 * * *';

function snapshot(
  overrides: Partial<CollectionIncrementalStatusSnapshotDto> = {},
): CollectionIncrementalStatusSnapshotDto {
  return {
    trackedRepositoryCount: 2,
    readyStreamCount: 6,
    backfillingStreamCount: 0,
    partialStreamCount: 0,
    retryPendingStreamCount: 0,
    oldestReadyCheckpointAt: new Date('2026-07-25T10:00:00.000Z'),
    latestCheckpointAt: new Date('2026-07-25T11:00:00.000Z'),
    oldestRetryPendingAt: null,
    lastCycleStartedAt: new Date('2026-07-25T10:55:00.000Z'),
    lastCycleCompletedAt: new Date('2026-07-25T11:00:00.000Z'),
    dueRepositoryCount: 0,
    failingRepositoryCount: 0,
    lastRepositorySuccessAt: new Date('2026-07-25T11:00:00.000Z'),
    ...overrides,
  };
}

describe('SystemStatusService', () => {
  const findActor = jest.fn();
  const getIncrementalStatusSnapshot = jest.fn();
  const getIncrementalStatusStreams = jest.fn();
  const countFinalProvisionFailures = jest.fn();
  const service = new SystemStatusService(
    {
      findActor,
      countFinalProvisionFailures,
    } as unknown as SystemStatusRepository,
    {
      getIncrementalStatusSnapshot,
      getIncrementalStatusStreams,
    } as unknown as ConstructorParameters<typeof SystemStatusService>[1],
    () => NOW,
    DAILY_0530_KST_CRON,
  );

  beforeEach(() => {
    findActor.mockReset().mockResolvedValue({
      role: Role.ADMIN,
      accountStatus: AccountStatus.ACTIVE,
    });
    getIncrementalStatusSnapshot.mockReset().mockResolvedValue(snapshot());
    getIncrementalStatusStreams.mockReset().mockResolvedValue([]);
    countFinalProvisionFailures.mockReset().mockResolvedValue(2);
  });

  it('ACTIVE ADMIN에게만 정확한 공개 DTO를 반환한다', async () => {
    await expect(service.getStatus(ACTOR_ID)).resolves.toEqual({
      collection: {
        health: 'NORMAL',
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
        currentRunStatus: 'IDLE',
        safeReason: null,
      },
      repositoryProvisioning: {
        finalFailureCount: 2,
      },
      collectionStreams: [],
    });
    expect(findActor).toHaveBeenCalledWith(ACTOR_ID);
    expect(getIncrementalStatusSnapshot).toHaveBeenCalledTimes(1);
    expect(getIncrementalStatusStreams).toHaveBeenCalledTimes(1);
    expect(countFinalProvisionFailures).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['없는 사용자', null],
    ['비 ADMIN', { role: Role.STAFF, accountStatus: AccountStatus.ACTIVE }],
    [
      '비활성 ADMIN',
      { role: Role.ADMIN, accountStatus: AccountStatus.DEACTIVATED },
    ],
  ])('%s는 거부하고 상태 데이터를 조회하지 않는다', async (_label, actor) => {
    findActor.mockResolvedValue(actor);
    await expect(service.getStatus(ACTOR_ID)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(getIncrementalStatusSnapshot).not.toHaveBeenCalled();
    expect(getIncrementalStatusStreams).not.toHaveBeenCalled();
    expect(countFinalProvisionFailures).not.toHaveBeenCalled();
  });

  it('추적 중인 저장소가 없으면 EMPTY다', async () => {
    getIncrementalStatusSnapshot.mockResolvedValue(
      snapshot({
        trackedRepositoryCount: 0,
        readyStreamCount: 0,
        oldestReadyCheckpointAt: null,
        latestCheckpointAt: null,
        lastCycleStartedAt: null,
        lastCycleCompletedAt: null,
        dueRepositoryCount: 0,
        failingRepositoryCount: 0,
        lastRepositorySuccessAt: null,
      }),
    );
    await expect(service.getStatus(ACTOR_ID)).resolves.toMatchObject({
      collection: { health: 'EMPTY', safeReason: 'NO_TRACKED_REPOSITORIES' },
    });
  });

  it('재시도 대기 중인 stream이 있으면 partial 진행 상황보다 FAILED를 우선한다', async () => {
    getIncrementalStatusSnapshot.mockResolvedValue(
      snapshot({ retryPendingStreamCount: 1, partialStreamCount: 2 }),
    );
    await expect(service.getStatus(ACTOR_ID)).resolves.toMatchObject({
      collection: { health: 'FAILED', safeReason: 'UPSTREAM_RATE_LIMITED' },
    });
  });

  it('partialStreamCount가 있으면 PARTIAL이다', async () => {
    getIncrementalStatusSnapshot.mockResolvedValue(
      snapshot({ partialStreamCount: 3 }),
    );
    await expect(service.getStatus(ACTOR_ID)).resolves.toMatchObject({
      collection: { health: 'PARTIAL', safeReason: 'RUN_INCOMPLETE' },
    });
  });

  it('backfillingStreamCount가 있으면 PARTIAL이다', async () => {
    getIncrementalStatusSnapshot.mockResolvedValue(
      snapshot({ backfillingStreamCount: 1 }),
    );
    await expect(service.getStatus(ACTOR_ID)).resolves.toMatchObject({
      collection: { health: 'PARTIAL', safeReason: 'RUN_INCOMPLETE' },
    });
  });

  it('90분보다 오래된 checkpoint만 DELAYED(STALE_DATA)다', async () => {
    getIncrementalStatusSnapshot.mockResolvedValue(
      snapshot({ latestCheckpointAt: new Date('2026-07-25T10:29:59.999Z') }),
    );
    await expect(service.getStatus(ACTOR_ID)).resolves.toMatchObject({
      collection: { health: 'DELAYED', safeReason: 'STALE_DATA' },
    });
  });

  it('정확히 90분 경계는 NORMAL이다', async () => {
    getIncrementalStatusSnapshot.mockResolvedValue(
      snapshot({ latestCheckpointAt: new Date('2026-07-25T10:30:00.000Z') }),
    );
    await expect(service.getStatus(ACTOR_ID)).resolves.toMatchObject({
      collection: { health: 'NORMAL', safeReason: null },
    });
  });

  it('사이클이 시작만 되고 아직 완료되지 않았으면 currentRunStatus는 PROCESSING이다', async () => {
    getIncrementalStatusSnapshot.mockResolvedValue(
      snapshot({
        lastCycleStartedAt: new Date('2026-07-25T11:55:00.000Z'),
        lastCycleCompletedAt: new Date('2026-07-25T11:00:00.000Z'),
      }),
    );
    await expect(service.getStatus(ACTOR_ID)).resolves.toMatchObject({
      collection: { currentRunStatus: 'PROCESSING' },
    });
  });

  it('사이클이 아예 시작된 적 없으면 currentRunStatus는 IDLE이다', async () => {
    getIncrementalStatusSnapshot.mockResolvedValue(
      snapshot({ lastCycleStartedAt: null, lastCycleCompletedAt: null }),
    );
    await expect(service.getStatus(ACTOR_ID)).resolves.toMatchObject({
      collection: { currentRunStatus: 'IDLE' },
    });
  });

  it('저장소별 stream 상세를 repositoryName·streamType 순서 그대로 응답 DTO로 옮긴다', async () => {
    const detail: readonly CollectionRepositoryStreamsDto[] = [
      {
        repositoryName: 'JNU-SWCU/alpha',
        streams: [
          {
            streamType: 'COMMIT',
            bucket: 'READY',
            lastSuccessAt: new Date('2026-07-25T10:00:00.000Z'),
            lastErrorCode: null,
            lastErrorAt: null,
          },
          {
            streamType: 'PULL_REQUEST',
            bucket: 'RETRY_PENDING',
            lastSuccessAt: null,
            lastErrorCode: 'COL_RATE_LIMITED',
            lastErrorAt: new Date('2026-07-25T09:00:00.000Z'),
          },
          {
            streamType: 'RELEASE',
            bucket: 'PARTIAL',
            lastSuccessAt: null,
            lastErrorCode: null,
            lastErrorAt: null,
          },
        ],
      },
    ];
    getIncrementalStatusStreams.mockResolvedValue(detail);

    const result = await service.getStatus(ACTOR_ID);

    expect(result.collectionStreams).toEqual([
      {
        repositoryName: 'JNU-SWCU/alpha',
        streams: [
          {
            streamType: 'COMMIT',
            bucket: 'READY',
            lastSuccessAt: '2026-07-25T10:00:00.000Z',
            lastErrorCode: null,
            lastErrorAt: null,
          },
          {
            streamType: 'PULL_REQUEST',
            bucket: 'RETRY_PENDING',
            lastSuccessAt: null,
            lastErrorCode: 'COL_RATE_LIMITED',
            lastErrorAt: '2026-07-25T09:00:00.000Z',
          },
          {
            streamType: 'RELEASE',
            bucket: 'PARTIAL',
            lastSuccessAt: null,
            lastErrorCode: null,
            lastErrorAt: null,
          },
        ],
      },
    ]);
  });

  describe('nextCycleAt', () => {
    it('배선된 cron 표현식과 clock으로 다음 사이클 시작 시각을 Asia/Seoul 기준으로 계산한다', async () => {
      const result = await service.getStatus(ACTOR_ID);
      // NOW = 2026-07-25T12:00:00.000Z = KST 2026-07-25 21:00:00.
      // '0 30 5 * * *'(매일 KST 05:30:00)의 다음 발생은 다음 날 05:30 KST = 전날 20:30 UTC.
      expect(result.collection.nextCycleAt).toBe('2026-07-25T20:30:00.000Z');
    });

    it('cron 표현식이 유효하지 않으면 nextCycleAt만 null이고 나머지 응답은 그대로다', async () => {
      const invalidCronService = new SystemStatusService(
        {
          findActor,
          countFinalProvisionFailures,
        } as unknown as SystemStatusRepository,
        {
          getIncrementalStatusSnapshot,
          getIncrementalStatusStreams,
        } as unknown as ConstructorParameters<typeof SystemStatusService>[1],
        () => NOW,
        'not-a-valid-cron-expression',
      );

      const result = await invalidCronService.getStatus(ACTOR_ID);

      expect(result.collection.nextCycleAt).toBeNull();
      expect(result.collection.health).toBe('NORMAL');
    });
  });
});

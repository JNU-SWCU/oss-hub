import type { CollectionScheduleService } from '../github/collection-schedule.service';
import {
  SystemStatusRepository,
  type CollectionExternalCollectionStatusDto,
  type CollectionIncrementalStatusSnapshotDto,
  type CollectionRepositoryStreamsDto,
} from './system-status.repository';
import { SystemStatusService } from './system-status.service';

const mockNextScheduledCollectionAt = jest.fn<
  ReturnType<CollectionScheduleService['nextScheduledCollectionAt']>,
  Parameters<CollectionScheduleService['nextScheduledCollectionAt']>
>();

const collectionSchedule = {
  nextScheduledCollectionAt: (from: Date) =>
    mockNextScheduledCollectionAt(from),
};

const nextScheduledAt = mockNextScheduledCollectionAt;

const NOW = new Date('2026-07-25T12:00:00.000Z');

function snapshot(
  overrides: Partial<CollectionIncrementalStatusSnapshotDto> = {},
): CollectionIncrementalStatusSnapshotDto {
  return {
    trackedRepositoryCount: 2,
    readyStreamCount: 8,
    backfillingStreamCount: 0,
    pendingStreamCount: 0,
    verifyingStreamCount: 0,
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

function externalStatus(
  overrides: Partial<CollectionExternalCollectionStatusDto> = {},
): CollectionExternalCollectionStatusDto {
  return {
    trackedRepositoryCount: 0,
    lastSuccessAt: null,
    ...overrides,
  };
}

describe('SystemStatusService', () => {
  const getIncrementalStatusSnapshot = jest.fn();
  const getIncrementalStatusStreams = jest.fn();
  const getExternalCollectionStatus = jest.fn();
  const countFinalProvisionFailures = jest.fn();
  const service = new SystemStatusService(
    {
      countFinalProvisionFailures,
      getIncrementalStatusSnapshot,
      getIncrementalStatusStreams,
      getExternalCollectionStatus,
    } as unknown as SystemStatusRepository,
    () => NOW,
    collectionSchedule,
  );

  beforeEach(() => {
    getIncrementalStatusSnapshot.mockReset().mockResolvedValue(snapshot());
    getIncrementalStatusStreams.mockReset().mockResolvedValue([]);
    nextScheduledAt
      .mockReset()
      .mockReturnValue(new Date('2026-07-25T20:30:00.000Z'));
    getExternalCollectionStatus.mockReset().mockResolvedValue(externalStatus());
    countFinalProvisionFailures.mockReset().mockResolvedValue(2);
  });

  it('ACTIVE ADMIN에게만 정확한 공개 DTO를 반환한다', async () => {
    await expect(service.getStatus()).resolves.toEqual({
      collection: {
        health: 'NORMAL',
        dataAsOf: new Date('2026-07-25T11:00:00.000Z'),
        trackedRepositoryCount: 2,
        readyStreamCount: 8,
        backfillingStreamCount: 0,
        partialStreamCount: 0,
        retryPendingStreamCount: 0,
        oldestReadyCheckpointAt: new Date('2026-07-25T10:00:00.000Z'),
        oldestRetryPendingAt: null,
        lastCycleStartedAt: new Date('2026-07-25T10:55:00.000Z'),
        lastCycleCompletedAt: new Date('2026-07-25T11:00:00.000Z'),
        lastSuccessAt: new Date('2026-07-25T11:00:00.000Z'),
        nextCycleAt: new Date('2026-07-25T20:30:00.000Z'),
        currentRunStatus: 'IDLE',
        safeReason: null,
      },
      repositoryProvisioning: {
        finalFailureCount: 2,
      },
      collectionStreams: [],
      externalCollection: {
        trackedRepositoryCount: 0,
        lastSuccessAt: null,
      },
    });
    expect(getIncrementalStatusSnapshot).toHaveBeenCalledTimes(1);
    expect(getIncrementalStatusStreams).toHaveBeenCalledTimes(1);
    expect(nextScheduledAt).toHaveBeenCalledWith(NOW);
    expect(getExternalCollectionStatus).toHaveBeenCalledTimes(1);
    expect(countFinalProvisionFailures).toHaveBeenCalledTimes(1);
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
    await expect(service.getStatus()).resolves.toMatchObject({
      collection: { health: 'EMPTY', safeReason: 'NO_TRACKED_REPOSITORIES' },
    });
  });

  it('재시도 대기 중인 stream이 있으면 partial 진행 상황보다 FAILED를 우선한다', async () => {
    getIncrementalStatusSnapshot.mockResolvedValue(
      snapshot({ retryPendingStreamCount: 1, pendingStreamCount: 2 }),
    );
    await expect(service.getStatus()).resolves.toMatchObject({
      collection: { health: 'FAILED', safeReason: 'UPSTREAM_RATE_LIMITED' },
    });
  });

  it('partialStreamCount가 있으면 PARTIAL이다', async () => {
    getIncrementalStatusSnapshot.mockResolvedValue(
      snapshot({ pendingStreamCount: 3 }),
    );
    await expect(service.getStatus()).resolves.toMatchObject({
      collection: { health: 'PARTIAL', safeReason: 'RUN_INCOMPLETE' },
    });
  });

  it('backfillingStreamCount가 있으면 PARTIAL이다', async () => {
    getIncrementalStatusSnapshot.mockResolvedValue(
      snapshot({ backfillingStreamCount: 1 }),
    );
    await expect(service.getStatus()).resolves.toMatchObject({
      collection: { health: 'PARTIAL', safeReason: 'RUN_INCOMPLETE' },
    });
  });

  it('90분보다 오래된 checkpoint만 DELAYED(STALE_DATA)다', async () => {
    getIncrementalStatusSnapshot.mockResolvedValue(
      snapshot({ latestCheckpointAt: new Date('2026-07-25T10:29:59.999Z') }),
    );
    await expect(service.getStatus()).resolves.toMatchObject({
      collection: { health: 'DELAYED', safeReason: 'STALE_DATA' },
    });
  });

  it('정확히 90분 경계는 NORMAL이다', async () => {
    getIncrementalStatusSnapshot.mockResolvedValue(
      snapshot({ latestCheckpointAt: new Date('2026-07-25T10:30:00.000Z') }),
    );
    await expect(service.getStatus()).resolves.toMatchObject({
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
    await expect(service.getStatus()).resolves.toMatchObject({
      collection: { currentRunStatus: 'PROCESSING' },
    });
  });

  it('사이클이 아예 시작된 적 없으면 currentRunStatus는 IDLE이다', async () => {
    getIncrementalStatusSnapshot.mockResolvedValue(
      snapshot({ lastCycleStartedAt: null, lastCycleCompletedAt: null }),
    );
    await expect(service.getStatus()).resolves.toMatchObject({
      collection: { currentRunStatus: 'IDLE' },
    });
  });

  it('저장소별 stream 상세를 repositoryName·streamType 순서 그대로 응답 DTO로 옮긴다', async () => {
    const detail: readonly CollectionRepositoryStreamsDto[] = [
      {
        repositoryName: 'JNU-SWCU/alpha',
        programName: '오픈소스 입문 프로그램',
        streams: [
          {
            streamType: 'COMMIT',
            status: 'READY',
            lastRunAt: new Date('2026-07-25T10:00:00.000Z'),
            lastErrorCode: null,
            lastErrorAt: null,
          },
          {
            streamType: 'PULL_REQUEST',
            status: 'BACKFILLING',
            lastRunAt: null,
            lastErrorCode: 'COL_RATE_LIMITED',
            lastErrorAt: new Date('2026-07-25T09:00:00.000Z'),
          },
          {
            streamType: 'RELEASE',
            status: 'PENDING',
            lastRunAt: null,
            lastErrorCode: null,
            lastErrorAt: null,
          },
        ],
      },
    ];
    getIncrementalStatusStreams.mockResolvedValue(detail);

    const result = await service.getStatus();

    expect(result.collectionStreams).toEqual([
      {
        repositoryName: 'JNU-SWCU/alpha',
        programName: '오픈소스 입문 프로그램',
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
          {
            streamType: 'ISSUE',
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
    it('수집 스케줄이 반환한 Date를 clock 시각으로 조회해 ISO 문자열로 옮긴다', async () => {
      nextScheduledAt.mockReturnValue(new Date('2026-07-25T20:30:00.000Z'));

      const result = await service.getStatus();

      expect(nextScheduledAt).toHaveBeenCalledWith(NOW);
      expect(result.collection.nextCycleAt).toEqual(
        new Date('2026-07-25T20:30:00.000Z'),
      );
    });

    it('수집 스케줄이 null을 반환하면(cron 표현식 계산 불가) nextCycleAt만 null이고 나머지 응답은 그대로다', async () => {
      nextScheduledAt.mockReturnValue(null);

      const result = await service.getStatus();

      expect(result.collection.nextCycleAt).toBeNull();
      expect(result.collection.health).toBe('NORMAL');
    });

    it('상태 스냅샷 조회를 시작하기 전에 스케줄을 먼저 계산한다', async () => {
      await service.getStatus();

      expect(nextScheduledAt).toHaveBeenCalledTimes(1);
      expect(getIncrementalStatusSnapshot).toHaveBeenCalledTimes(1);
      const scheduleOrder =
        nextScheduledAt.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY;
      const snapshotOrder =
        getIncrementalStatusSnapshot.mock.invocationCallOrder[0] ??
        Number.POSITIVE_INFINITY;
      expect(scheduleOrder).toBeLessThan(snapshotOrder);
    });
  });

  describe('externalCollection', () => {
    it('외부 저장소의 마지막 수집 성공 시각을 org 지표와 별개로 옮긴다', async () => {
      getExternalCollectionStatus.mockResolvedValue(
        externalStatus({
          trackedRepositoryCount: 3,
          lastSuccessAt: new Date('2026-07-25T10:00:00.000Z'),
        }),
      );

      const result = await service.getStatus();

      expect(result.externalCollection).toEqual({
        trackedRepositoryCount: 3,
        lastSuccessAt: new Date('2026-07-25T10:00:00.000Z'),
      });
      expect(result.collection.trackedRepositoryCount).toBe(2);
      expect(result.collection.lastSuccessAt).toEqual(
        new Date('2026-07-25T11:00:00.000Z'),
      );
    });
  });
});

import { ForbiddenException } from '@nestjs/common';
import { AccountStatus, Role } from '@prisma/client';
import type {
  CollectionIncrementalStatusSnapshotDto,
  CollectionRepositoryStreamsDto,
  CollectionSweepActivityDto,
} from '../github/collection-read.port';
import { SystemStatusRepository } from './system-status.repository';
import { SystemStatusService } from './system-status.service';

const NOW = new Date('2026-07-25T12:00:00.000Z');
const ACTOR_ID = 133n;

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
  const getNextScheduledCycleAt = jest.fn();
  const getRecentSweepActivity = jest.fn();
  const countFinalProvisionFailures = jest.fn();
  const service = new SystemStatusService(
    {
      findActor,
      countFinalProvisionFailures,
    } as unknown as SystemStatusRepository,
    {
      getIncrementalStatusSnapshot,
      getIncrementalStatusStreams,
      getNextScheduledCycleAt,
      getRecentSweepActivity,
    } as unknown as ConstructorParameters<typeof SystemStatusService>[1],
    () => NOW,
  );

  beforeEach(() => {
    findActor.mockReset().mockResolvedValue({
      role: Role.ADMIN,
      accountStatus: AccountStatus.ACTIVE,
    });
    getIncrementalStatusSnapshot.mockReset().mockResolvedValue(snapshot());
    getIncrementalStatusStreams.mockReset().mockResolvedValue([]);
    getNextScheduledCycleAt
      .mockReset()
      .mockResolvedValue(new Date('2026-07-25T20:30:00.000Z'));
    getRecentSweepActivity.mockReset().mockResolvedValue([]);
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
      collectionActivity: [],
    });
    expect(findActor).toHaveBeenCalledWith(ACTOR_ID);
    expect(getIncrementalStatusSnapshot).toHaveBeenCalledTimes(1);
    expect(getIncrementalStatusStreams).toHaveBeenCalledTimes(1);
    expect(getNextScheduledCycleAt).toHaveBeenCalledWith(NOW);
    expect(getRecentSweepActivity).toHaveBeenCalledWith(20);
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
    expect(getNextScheduledCycleAt).not.toHaveBeenCalled();
    expect(getRecentSweepActivity).not.toHaveBeenCalled();
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

  it('최근 sweep 활동 이력을 Date -> ISO 변환해 collectionActivity로 옮긴다', async () => {
    const activity: readonly CollectionSweepActivityDto[] = [
      {
        sweepFinishedAt: new Date('2026-07-25T11:00:00.000Z'),
        cycleStartedAt: new Date('2026-07-25T10:55:00.000Z'),
        scope: 'org:JNU-SWCU',
        insertedCommitCount: 3,
        insertedPullRequestCount: 1,
        insertedReleaseCount: 0,
        attemptedRepositoryCount: 2,
        processedRepositoryCount: 2,
        failedRepositoryCount: 0,
        cycleCompleted: true,
        stoppedForBudget: false,
      },
      {
        sweepFinishedAt: new Date('2026-07-25T10:00:00.000Z'),
        cycleStartedAt: null,
        scope: 'external',
        insertedCommitCount: 0,
        insertedPullRequestCount: 0,
        insertedReleaseCount: 0,
        attemptedRepositoryCount: 1,
        processedRepositoryCount: 0,
        failedRepositoryCount: 1,
        cycleCompleted: false,
        stoppedForBudget: true,
      },
    ];
    getRecentSweepActivity.mockResolvedValue(activity);

    const result = await service.getStatus(ACTOR_ID);

    expect(result.collectionActivity).toEqual([
      {
        sweepFinishedAt: '2026-07-25T11:00:00.000Z',
        cycleStartedAt: '2026-07-25T10:55:00.000Z',
        scope: 'org:JNU-SWCU',
        insertedCommitCount: 3,
        insertedPullRequestCount: 1,
        insertedReleaseCount: 0,
        attemptedRepositoryCount: 2,
        processedRepositoryCount: 2,
        failedRepositoryCount: 0,
        cycleCompleted: true,
        stoppedForBudget: false,
      },
      {
        sweepFinishedAt: '2026-07-25T10:00:00.000Z',
        cycleStartedAt: null,
        scope: 'external',
        insertedCommitCount: 0,
        insertedPullRequestCount: 0,
        insertedReleaseCount: 0,
        attemptedRepositoryCount: 1,
        processedRepositoryCount: 0,
        failedRepositoryCount: 1,
        cycleCompleted: false,
        stoppedForBudget: true,
      },
    ]);
  });

  describe('nextCycleAt', () => {
    it('port가 반환한 Date를 clock 시각으로 조회해 ISO 문자열로 옮긴다', async () => {
      getNextScheduledCycleAt.mockResolvedValue(
        new Date('2026-07-25T20:30:00.000Z'),
      );

      const result = await service.getStatus(ACTOR_ID);

      expect(getNextScheduledCycleAt).toHaveBeenCalledWith(NOW);
      expect(result.collection.nextCycleAt).toBe('2026-07-25T20:30:00.000Z');
    });

    it('port가 null을 반환하면(cron 표현식 계산 불가) nextCycleAt만 null이고 나머지 응답은 그대로다', async () => {
      getNextScheduledCycleAt.mockResolvedValue(null);

      const result = await service.getStatus(ACTOR_ID);

      expect(result.collection.nextCycleAt).toBeNull();
      expect(result.collection.health).toBe('NORMAL');
    });
  });
});

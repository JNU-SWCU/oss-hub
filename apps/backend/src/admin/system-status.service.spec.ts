import type { CollectionScheduleService } from '../github/collection-schedule.service';
import {
  SystemStatusRepository,
  type CollectionExternalCollectionStatusDto,
  type CollectionRepositoryStatusDto,
} from './system-status.repository';
import { SystemStatusService } from './system-status.service';

const nextScheduledAt = jest.fn<
  ReturnType<CollectionScheduleService['nextScheduledCollectionAt']>,
  Parameters<CollectionScheduleService['nextScheduledCollectionAt']>
>();

const NOW = new Date('2026-07-25T12:00:00.000Z');

function repository(
  repositoryName: string,
  lastSuccessAt: Date | null,
): CollectionRepositoryStatusDto {
  return { repositoryName, programName: '2026 오픈소스', lastSuccessAt };
}

function externalStatus(
  overrides: Partial<CollectionExternalCollectionStatusDto> = {},
): CollectionExternalCollectionStatusDto {
  return { trackedRepositoryCount: 0, lastSuccessAt: null, ...overrides };
}

describe('SystemStatusService', () => {
  const getCollectionRepositories = jest.fn();
  const hasActiveCollectionRun = jest.fn();
  const getExternalCollectionStatus = jest.fn();
  const countFinalProvisionFailures = jest.fn();
  const service = new SystemStatusService(
    {
      countFinalProvisionFailures,
      getCollectionRepositories,
      hasActiveCollectionRun,
      getExternalCollectionStatus,
    } as unknown as SystemStatusRepository,
    () => NOW,
    { nextScheduledCollectionAt: (from: Date) => nextScheduledAt(from) },
  );

  beforeEach(() => {
    getCollectionRepositories
      .mockReset()
      .mockResolvedValue([
        repository('org/alpha', new Date('2026-07-25T11:55:00.000Z')),
        repository('org/beta', new Date('2026-07-25T11:00:00.000Z')),
      ]);
    hasActiveCollectionRun.mockReset().mockResolvedValue(false);
    nextScheduledAt
      .mockReset()
      .mockReturnValue(new Date('2026-07-25T13:00:00.000Z'));
    getExternalCollectionStatus.mockReset().mockResolvedValue(externalStatus());
    countFinalProvisionFailures.mockReset().mockResolvedValue(2);
  });

  it('저장소마다 repo.last_success_at과 지연 여부를 돌려준다', async () => {
    await expect(service.getStatus()).resolves.toEqual({
      collection: {
        health: 'NORMAL',
        trackedRepositoryCount: 2,
        staleRepositoryCount: 0,
        lastSuccessAt: new Date('2026-07-25T11:55:00.000Z'),
        nextCycleAt: new Date('2026-07-25T13:00:00.000Z'),
        currentRunStatus: 'IDLE',
        safeReason: null,
      },
      repositoryProvisioning: { finalFailureCount: 2 },
      collectionRepositories: [
        {
          ...repository('org/alpha', new Date('2026-07-25T11:55:00.000Z')),
          stale: false,
        },
        {
          ...repository('org/beta', new Date('2026-07-25T11:00:00.000Z')),
          stale: false,
        },
      ],
      externalCollection: { trackedRepositoryCount: 0, lastSuccessAt: null },
    });
    expect(nextScheduledAt).toHaveBeenCalledWith(NOW);
    expect(hasActiveCollectionRun).toHaveBeenCalledWith(NOW);
  });

  it('추적 중인 저장소가 없으면 EMPTY다', async () => {
    getCollectionRepositories.mockResolvedValue([]);

    const { collection } = await service.getStatus();

    expect(collection).toMatchObject({
      health: 'EMPTY',
      trackedRepositoryCount: 0,
      lastSuccessAt: null,
      safeReason: 'NO_TRACKED_REPOSITORIES',
    });
  });

  it('마지막 성공이 2시간보다 오래된 저장소가 하나라도 있으면 DELAYED다', async () => {
    getCollectionRepositories.mockResolvedValue([
      repository('org/alpha', new Date('2026-07-25T11:55:00.000Z')),
      repository('org/beta', new Date('2026-07-25T09:59:59.999Z')),
    ]);

    const result = await service.getStatus();

    expect(result.collection).toMatchObject({
      health: 'DELAYED',
      staleRepositoryCount: 1,
      safeReason: 'STALE_DATA',
    });
    expect(
      result.collectionRepositories.map(({ repositoryName, stale }) => [
        repositoryName,
        stale,
      ]),
    ).toEqual([
      ['org/alpha', false],
      ['org/beta', true],
    ]);
  });

  it('정확히 2시간 된 성공과 아직 수집되지 않은 저장소는 지연이 아니다', async () => {
    getCollectionRepositories.mockResolvedValue([
      repository('org/alpha', new Date('2026-07-25T10:00:00.000Z')),
      repository('org/new', null),
    ]);

    const { collection, collectionRepositories } = await service.getStatus();

    expect(collection.health).toBe('NORMAL');
    expect(collectionRepositories.every((row) => !row.stale)).toBe(true);
  });

  it('만료되지 않은 수집 잠금이 있으면 PROCESSING이다', async () => {
    hasActiveCollectionRun.mockResolvedValue(true);

    const { collection } = await service.getStatus();

    expect(collection.currentRunStatus).toBe('PROCESSING');
  });

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
    expect(result.collection.lastSuccessAt).toEqual(
      new Date('2026-07-25T11:55:00.000Z'),
    );
  });
});

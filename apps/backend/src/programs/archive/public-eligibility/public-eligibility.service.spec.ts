import type {
  CollectionReadPort,
  CollectionRepositoryMetricsDto,
  CollectionRepositoryMetricsQueryDto,
} from '../../../github/collection-read.port';
import {
  PublicEligibilityService,
  type PublicEligibilityCandidate,
} from './public-eligibility.service';

const publishedAt = new Date('2026-07-15T00:00:00.000Z');

function metric(
  overrides: Partial<CollectionRepositoryMetricsDto> &
    Pick<CollectionRepositoryMetricsDto, 'repositoryId'>,
): CollectionRepositoryMetricsDto {
  return {
    year: 2026,
    dataAsOf: new Date('2026-07-31T00:00:00.000Z'),
    commitCount: 0,
    pullRequestCount: 0,
    releaseCount: 0,
    visibility: 'PUBLIC',
    presence: 'PRESENT',
    visibilityObservedAt: null,
    ...overrides,
  };
}

function serviceWith(
  getRepositoryMetrics: jest.Mock<
    Promise<readonly CollectionRepositoryMetricsDto[]>,
    [CollectionRepositoryMetricsQueryDto]
  >,
): PublicEligibilityService {
  const collection: CollectionReadPort = {
    findRepositoryActivity: () => Promise.resolve([]),
    getRepositoryMetrics,
    getContributorMetrics: () => Promise.resolve([]),
    getPublicRankingMetrics: () => Promise.resolve([]),
    listPublicRankingYears: () => Promise.resolve([]),
    getPublicRankingDataAsOf: () => Promise.resolve(null),
    getRepositoryCumulativeMetrics: () => Promise.resolve([]),
    getContributorCumulativeMetrics: () => Promise.resolve([]),
    getIncrementalStatusSnapshot: () =>
      Promise.resolve({
        trackedRepositoryCount: 0,
        readyStreamCount: 0,
        backfillingStreamCount: 0,
        partialStreamCount: 0,
        retryPendingStreamCount: 0,
        oldestReadyCheckpointAt: null,
        latestCheckpointAt: null,
        oldestRetryPendingAt: null,
        lastCycleStartedAt: null,
        lastCycleCompletedAt: null,
        dueRepositoryCount: 0,
        failingRepositoryCount: 0,
        lastRepositorySuccessAt: null,
      }),
    getIncrementalStatusStreams: () => Promise.resolve([]),
    getNextScheduledCycleAt: () => Promise.resolve(null),
    getRecentSweepActivity: () => Promise.resolve([]),
    getExternalCollectionStatus: () =>
      Promise.resolve({
        trackedRepositoryCount: 0,
        lastSweep: null,
        cumulativeCommitCount: 0,
        cumulativePullRequestCount: 0,
        cumulativeReleaseCount: 0,
      }),
  };
  return new PublicEligibilityService(collection);
}

describe('PublicEligibilityService', () => {
  it('빈 후보 배치는 port를 호출하지 않고 빈 집합을 반환한다', async () => {
    const getRepositoryMetrics = jest.fn<
      Promise<readonly CollectionRepositoryMetricsDto[]>,
      [CollectionRepositoryMetricsQueryDto]
    >();
    const service = serviceWith(getRepositoryMetrics);

    const result = await service.filterEligibleRepositoryIds([]);

    expect(result).toEqual(new Set());
    expect(getRepositoryMetrics).not.toHaveBeenCalled();
  });

  it('managed publication fixture — 다음 inventory 전이라도 collection 관측이 아예 없으면 즉시 공개된다', async () => {
    const getRepositoryMetrics = jest
      .fn<
        Promise<readonly CollectionRepositoryMetricsDto[]>,
        [CollectionRepositoryMetricsQueryDto]
      >()
      .mockResolvedValue([]);
    const service = serviceWith(getRepositoryMetrics);
    const candidate: PublicEligibilityCandidate = {
      githubRepositoryId: 101n,
      publishedAt,
    };

    const result = await service.filterEligibleRepositoryIds([candidate]);

    expect(result).toEqual(new Set([101n]));
    expect(getRepositoryMetrics).toHaveBeenCalledWith({
      repositoryIds: [101n],
    });
  });

  it('managed publication fixture — 발행 이후 complete PUBLIC/PRESENT 관측이면 공개를 유지한다', async () => {
    const getRepositoryMetrics = jest
      .fn<
        Promise<readonly CollectionRepositoryMetricsDto[]>,
        [CollectionRepositoryMetricsQueryDto]
      >()
      .mockResolvedValue([
        metric({
          repositoryId: 101n,
          visibility: 'PUBLIC',
          presence: 'PRESENT',
          visibilityObservedAt: new Date(publishedAt.getTime() + 1),
        }),
      ]);
    const service = serviceWith(getRepositoryMetrics);

    const result = await service.filterEligibleRepositoryIds([
      { githubRepositoryId: 101n, publishedAt },
    ]);

    expect(result).toEqual(new Set([101n]));
  });

  it('발행 이후 complete private 관측은 회수한다(비공개)', async () => {
    const getRepositoryMetrics = jest
      .fn<
        Promise<readonly CollectionRepositoryMetricsDto[]>,
        [CollectionRepositoryMetricsQueryDto]
      >()
      .mockResolvedValue([
        metric({
          repositoryId: 101n,
          visibility: 'PRIVATE',
          presence: 'PRESENT',
          visibilityObservedAt: new Date(publishedAt.getTime() + 1),
        }),
      ]);
    const service = serviceWith(getRepositoryMetrics);

    const result = await service.filterEligibleRepositoryIds([
      { githubRepositoryId: 101n, publishedAt },
    ]);

    expect(result).toEqual(new Set());
  });

  it('발행 이전(stale)의 complete private 관측은 회수하지 않는다', async () => {
    const getRepositoryMetrics = jest
      .fn<
        Promise<readonly CollectionRepositoryMetricsDto[]>,
        [CollectionRepositoryMetricsQueryDto]
      >()
      .mockResolvedValue([
        metric({
          repositoryId: 101n,
          visibility: 'PRIVATE',
          presence: 'PRESENT',
          visibilityObservedAt: new Date(publishedAt.getTime() - 1),
        }),
      ]);
    const service = serviceWith(getRepositoryMetrics);

    const result = await service.filterEligibleRepositoryIds([
      { githubRepositoryId: 101n, publishedAt },
    ]);

    expect(result).toEqual(new Set([101n]));
  });

  it('partial inventory fixture — complete 관측이 없는(observedAt null) 저장소는 missing을 주장하지 않는다', async () => {
    const getRepositoryMetrics = jest
      .fn<
        Promise<readonly CollectionRepositoryMetricsDto[]>,
        [CollectionRepositoryMetricsQueryDto]
      >()
      .mockResolvedValue([
        metric({
          repositoryId: 101n,
          // partial run은 visibility/presence를 절대 갱신하지 않으므로 스키마 기본값(PRIVATE)이
          // 신뢰할 수 없는 상태로 남아있을 수 있다 — observedAt이 null이면 이 값을 무시한다.
          visibility: 'PRIVATE',
          presence: 'PRESENT',
          visibilityObservedAt: null,
        }),
      ]);
    const service = serviceWith(getRepositoryMetrics);

    const result = await service.filterEligibleRepositoryIds([
      { githubRepositoryId: 101n, publishedAt },
    ]);

    expect(result).toEqual(new Set([101n]));
  });

  it('delayed activity failure fixture — commit/PR 집계가 지연·0으로 멈춰 있어도(dataAsOf가 낡아도) 판정은 visibility 관측만으로 내려진다', async () => {
    const staleActivity = {
      dataAsOf: new Date('2020-01-01T00:00:00.000Z'),
      commitCount: 0,
      pullRequestCount: 0,
      releaseCount: 0,
    };
    const getRepositoryMetrics = jest
      .fn<
        Promise<readonly CollectionRepositoryMetricsDto[]>,
        [CollectionRepositoryMetricsQueryDto]
      >()
      .mockResolvedValue([
        metric({
          repositoryId: 101n,
          ...staleActivity,
          visibility: 'PUBLIC',
          presence: 'PRESENT',
          visibilityObservedAt: new Date(publishedAt.getTime() + 1),
        }),
        metric({
          repositoryId: 102n,
          ...staleActivity,
          visibility: 'PRIVATE',
          presence: 'PRESENT',
          visibilityObservedAt: new Date(publishedAt.getTime() + 1),
        }),
      ]);
    const service = serviceWith(getRepositoryMetrics);

    const result = await service.filterEligibleRepositoryIds([
      { githubRepositoryId: 101n, publishedAt },
      { githubRepositoryId: 102n, publishedAt },
    ]);

    // 101n은 activity 집계가 지연됐어도 visibility 관측이 PUBLIC/PRESENT라 공개.
    // 102n은 activity와 무관하게 private 관측(발행 이후)이라 비공개 — 둘 다 dataAsOf/count가
    // 아니라 visibility/presence/visibilityObservedAt만으로 결정됨을 증명한다.
    expect(result).toEqual(new Set([101n]));
  });

  it('platform-private(후보에 없는) 저장소는 collection 관측과 무관하게 항상 결과에서 빠진다', async () => {
    const getRepositoryMetrics = jest
      .fn<
        Promise<readonly CollectionRepositoryMetricsDto[]>,
        [CollectionRepositoryMetricsQueryDto]
      >()
      .mockResolvedValue([
        metric({
          repositoryId: 999n,
          visibility: 'PUBLIC',
          presence: 'PRESENT',
          visibilityObservedAt: new Date(publishedAt.getTime() + 1),
        }),
      ]);
    const service = serviceWith(getRepositoryMetrics);

    // 999n은 platform eligibility가 없어 애초에 후보로 넘기지 않는다(호출자 책임).
    const result = await service.filterEligibleRepositoryIds([]);

    expect(result).toEqual(new Set());
    expect(getRepositoryMetrics).not.toHaveBeenCalled();
  });

  describe('isEligible', () => {
    it('단건 후보를 배치 경로로 위임해 동일한 정책을 적용한다', async () => {
      const getRepositoryMetrics = jest
        .fn<
          Promise<readonly CollectionRepositoryMetricsDto[]>,
          [CollectionRepositoryMetricsQueryDto]
        >()
        .mockResolvedValue([
          metric({
            repositoryId: 101n,
            visibility: 'PRIVATE',
            presence: 'PRESENT',
            visibilityObservedAt: new Date(publishedAt.getTime() + 1),
          }),
        ]);
      const service = serviceWith(getRepositoryMetrics);

      const result = await service.isEligible({
        githubRepositoryId: 101n,
        publishedAt,
      });

      expect(result).toBe(false);
    });
  });
});

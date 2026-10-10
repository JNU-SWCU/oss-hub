import { nextScheduledCollectionAt } from '../../github/service/collection-schedule';
import type { RankingViewerClass } from '../domain/ranking';
import type {
  RankingMetricRow,
  RankingRepository,
} from '../repository/ranking.repository';
import { RankingService } from './ranking.service';

jest.mock('../../github/service/collection-schedule', () => ({
  nextScheduledCollectionAt: jest.fn(),
}));

const nextScheduledAt = jest.mocked(nextScheduledCollectionAt);

export function activity(
  githubId: bigint,
  githubLogin: string,
  metrics: Partial<{
    commitCount: number;
    pullRequestCount: number;
    issueCount: number;
    repositoryCount: number;
    starCount: number;
    department: string | null;
  }>,
): RankingMetricRow {
  return {
    githubId,
    githubLogin,
    department: metrics.department ?? null,
    commitCount: metrics.commitCount ?? 0,
    pullRequestCount: metrics.pullRequestCount ?? 0,
    issueCount: metrics.issueCount ?? 0,
    repositoryCount: metrics.repositoryCount ?? 0,
    starCount: metrics.starCount ?? 0,
  };
}

export function setupRankingService(): {
  readonly service: RankingService;
  readonly findMetrics: jest.Mock<
    Promise<readonly RankingMetricRow[]>,
    [{ currentYear?: number }]
  >;
  readonly listYears: jest.Mock<Promise<readonly number[]>, []>;
  readonly findDataAsOf: jest.Mock<Promise<Date | null>, []>;
  readonly findViewerClass: jest.Mock<
    Promise<RankingViewerClass>,
    [bigint | null]
  >;
  readonly findNamesByGithubIds: jest.Mock<
    Promise<ReadonlyMap<bigint, string | null>>,
    [readonly bigint[]]
  >;
  readonly nextScheduledCollectionAt: jest.MockedFunction<
    typeof nextScheduledCollectionAt
  >;
} {
  const findMetrics = jest.fn<
    Promise<readonly RankingMetricRow[]>,
    [{ currentYear?: number }]
  >();
  findMetrics.mockResolvedValue([]);
  const listYears = jest.fn<Promise<readonly number[]>, []>();
  listYears.mockResolvedValue([]);
  const findDataAsOf = jest.fn<Promise<Date | null>, []>();
  findDataAsOf.mockResolvedValue(null);
  const findViewerClass = jest.fn<
    Promise<RankingViewerClass>,
    [bigint | null]
  >();
  findViewerClass.mockResolvedValue('public');
  const findNamesByGithubIds = jest.fn<
    Promise<ReadonlyMap<bigint, string | null>>,
    [readonly bigint[]]
  >();
  findNamesByGithubIds.mockResolvedValue(new Map());
  nextScheduledAt.mockReset().mockReturnValue(null);

  const ranking = {
    findMetrics,
    listYears,
    findDataAsOf,
    findViewerClass,
    findNamesByGithubIds,
  } as unknown as RankingRepository;

  return {
    service: new RankingService(ranking),
    findMetrics,
    listYears,
    findDataAsOf,
    findViewerClass,
    findNamesByGithubIds,
    nextScheduledCollectionAt: nextScheduledAt,
  };
}

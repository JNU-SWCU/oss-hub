import { nextScheduledCollectionAt } from '../../github/service/collection-schedule';
import type { RankingViewerClass } from '../domain/ranking';
import type {
  RankingMetricRow,
  RankingRepository,
  RankingSnapshotRow,
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

export function snapshot(
  githubId: bigint,
  snapshotDate: string,
  metrics: Partial<{
    commitCount: number;
    pullRequestCount: number;
    issueCount: number;
    repositoryCount: number;
    starCount: number;
  }>,
): RankingSnapshotRow {
  return {
    githubId,
    snapshotDate: new Date(`${snapshotDate}T00:00:00.000Z`),
    commitCount: metrics.commitCount ?? 0,
    pullRequestCount: metrics.pullRequestCount ?? 0,
    issueCount: metrics.issueCount ?? 0,
    repositoryCount: metrics.repositoryCount ?? 0,
    starCount: metrics.starCount ?? 0,
  };
}

export function setupRankingService() {
  const findMetrics = jest
    .fn<Promise<readonly RankingMetricRow[]>, [{ currentYear?: number }]>()
    .mockResolvedValue([]);
  const listYears = jest
    .fn<Promise<readonly number[]>, []>()
    .mockResolvedValue([]);
  const findDataAsOf = jest
    .fn<Promise<Date | null>, []>()
    .mockResolvedValue(null);
  const findViewerClass = jest
    .fn<Promise<RankingViewerClass>, [bigint | null]>()
    .mockResolvedValue('public');
  const findNamesByGithubIds = jest
    .fn<Promise<ReadonlyMap<bigint, string | null>>, [readonly bigint[]]>()
    .mockResolvedValue(new Map());
  const findMonthlySnapshots = jest
    .fn<Promise<readonly RankingSnapshotRow[]>, [number]>()
    .mockResolvedValue([]);
  const findViewerGithubLogin = jest
    .fn<Promise<string | null>, [bigint]>()
    .mockResolvedValue(null);
  nextScheduledAt.mockReset().mockReturnValue(null);

  const ranking = {
    findMetrics,
    listYears,
    findDataAsOf,
    findViewerClass,
    findNamesByGithubIds,
    findMonthlySnapshots,
    findViewerGithubLogin,
  } as unknown as RankingRepository;

  return {
    service: new RankingService(ranking),
    findMetrics,
    listYears,
    findDataAsOf,
    findViewerClass,
    findNamesByGithubIds,
    findMonthlySnapshots,
    findViewerGithubLogin,
    nextScheduledCollectionAt: nextScheduledAt,
  };
}

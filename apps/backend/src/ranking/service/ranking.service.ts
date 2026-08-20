import { Injectable } from '@nestjs/common';
import {
  RANKING_VIEWER_CLASSES,
  RANKING_YEAR_ALL,
  type RankingEntry,
  type RankingPage,
  type RankingYear,
} from '../domain/ranking';
import {
  RankingRepository,
  type RankingMetricRow,
} from '../repository/ranking.repository';

interface RankedPublicEntry extends RankingEntry {
  readonly githubId: bigint;
}

@Injectable()
export class RankingService {
  private readonly inFlightBuilds = new Map<
    string,
    Promise<readonly RankedPublicEntry[]>
  >();

  constructor(private readonly ranking: RankingRepository) {}

  async findPage(
    year: RankingYear,
    page: number,
    pageSize: number,
    githubId: bigint | null,
  ): Promise<RankingPage> {
    const [entries, dataAsOf, viewerClass] = await Promise.all([
      this.findPublicEntries(year),
      this.ranking.findDataAsOf(),
      this.ranking.findViewerClass(githubId),
    ]);
    const start = (page - 1) * pageSize;
    const slice = entries.slice(start, start + pageSize);
    const nextCycleAt = this.ranking.findNextCycleAt(new Date());

    if (viewerClass !== RANKING_VIEWER_CLASSES.STAFF) {
      return {
        year,
        items: slice.map(toPublicEntry),
        page,
        pageSize,
        total: entries.length,
        dataAsOf,
        viewerClass: RANKING_VIEWER_CLASSES.PUBLIC,
        nextCycleAt,
      };
    }

    try {
      return {
        year,
        items: await this.attachStaffNames(slice),
        page,
        pageSize,
        total: entries.length,
        dataAsOf,
        viewerClass: RANKING_VIEWER_CLASSES.STAFF,
        nextCycleAt,
      };
    } catch {
      return {
        year,
        items: slice.map(toPublicEntry),
        page,
        pageSize,
        total: entries.length,
        dataAsOf,
        viewerClass: RANKING_VIEWER_CLASSES.PUBLIC,
        nextCycleAt,
      };
    }
  }

  async listYears(): Promise<readonly number[]> {
    return this.ranking.listYears();
  }

  async findDataAsOf(): Promise<Date | null> {
    return this.ranking.findDataAsOf();
  }

  private async findPublicEntries(
    year: RankingYear,
  ): Promise<readonly RankedPublicEntry[]> {
    const cacheKey =
      year === RANKING_YEAR_ALL ? RANKING_YEAR_ALL : `year:${year}`;
    const existingBuild = this.inFlightBuilds.get(cacheKey);
    if (existingBuild) return existingBuild;

    const build = this.buildPublicEntries(year).finally(() =>
      this.inFlightBuilds.delete(cacheKey),
    );
    this.inFlightBuilds.set(cacheKey, build);
    return build;
  }

  private async buildPublicEntries(
    year: RankingYear,
  ): Promise<readonly RankedPublicEntry[]> {
    const activity = await this.ranking.findMetrics(
      year === RANKING_YEAR_ALL ? {} : { currentYear: year },
    );
    const candidates = activity.map((row) => ({
      githubId: row.githubId,
      githubLogin: row.githubLogin,
      department: row.department,
      commitCount: row.commitCount,
      pullRequestCount: row.pullRequestCount,
      issueCount: row.issueCount,
      repositoryCount: row.repositoryCount,
      starCount: row.starCount,
      total: rankingTotal(row),
    }));

    return [...candidates]
      .sort((left, right) => {
        const normalizedLoginOrder = left.githubLogin
          .normalize()
          .toLocaleLowerCase('en-US')
          .localeCompare(
            right.githubLogin.normalize().toLocaleLowerCase('en-US'),
            'en-US',
          );
        return (
          right.total - left.total ||
          right.commitCount - left.commitCount ||
          right.pullRequestCount - left.pullRequestCount ||
          right.issueCount - left.issueCount ||
          right.repositoryCount - left.repositoryCount ||
          right.starCount - left.starCount ||
          normalizedLoginOrder ||
          (left.githubId < right.githubId
            ? -1
            : left.githubId > right.githubId
              ? 1
              : 0)
        );
      })
      .map((entry, index) => ({
        githubId: entry.githubId,
        rank: index + 1,
        displayName: entry.githubLogin,
        githubLogin: entry.githubLogin,
        department: entry.department,
        commitCount: entry.commitCount,
        pullRequestCount: entry.pullRequestCount,
        issueCount: entry.issueCount,
        repositoryCount: entry.repositoryCount,
        starCount: entry.starCount,
        total: entry.total,
      }));
  }

  private async attachStaffNames(
    slice: readonly RankedPublicEntry[],
  ): Promise<readonly RankingEntry[]> {
    const names = await this.ranking.findNamesByGithubIds(
      slice.map((entry) => entry.githubId),
    );
    return slice.map((entry) => ({
      ...toPublicEntry(entry),
      name: names.get(entry.githubId) ?? null,
    }));
  }
}

function rankingTotal(row: RankingMetricRow): number {
  return (
    row.commitCount +
    row.pullRequestCount +
    row.issueCount +
    row.repositoryCount +
    row.starCount
  );
}

function toPublicEntry(entry: RankedPublicEntry): RankingEntry {
  return {
    rank: entry.rank,
    displayName: entry.githubLogin,
    githubLogin: entry.githubLogin,
    department: entry.department,
    commitCount: entry.commitCount,
    pullRequestCount: entry.pullRequestCount,
    issueCount: entry.issueCount,
    repositoryCount: entry.repositoryCount,
    starCount: entry.starCount,
    total: entry.total,
  };
}

import { Injectable } from '@nestjs/common';
import { CollectionScheduleService } from '../github/collection-schedule.service';
import { RankingRepository } from './ranking.repository';

export interface ActivityCounts {
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
  readonly repositoryCount: number;
  readonly starCount: number;
}

export function activityTotal(activity: ActivityCounts): number {
  return (
    activity.commitCount +
    activity.pullRequestCount +
    activity.issueCount +
    activity.repositoryCount +
    activity.starCount
  );
}

const ASIA_SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;

export function rankingYearInAsiaSeoul(date: Date): number {
  return new Date(date.getTime() + ASIA_SEOUL_OFFSET_MS).getUTCFullYear();
}

export function rankingYearStartInAsiaSeoul(year: number): Date {
  return new Date(Date.UTC(year, 0, 1) - ASIA_SEOUL_OFFSET_MS);
}

export const RANKING_YEAR_ALL = 'all' as const;

export const RANKING_YEAR_MIN = 2000;

export const RANKING_YEAR_MAX = 2100;

export type RankingYear = number | typeof RANKING_YEAR_ALL;

export const LEGACY_RANKING_PERIODS = {
  THIS_YEAR: 'THIS_YEAR',
  ALL: 'ALL',
} as const;

export type LegacyRankingPeriod =
  (typeof LEGACY_RANKING_PERIODS)[keyof typeof LEGACY_RANKING_PERIODS];

export const RANKING_VIEWER_CLASSES = {
  PUBLIC: 'public',
  MEMBER: 'member',
  STAFF: 'staff',
} as const;

export type RankingViewerClass =
  (typeof RANKING_VIEWER_CLASSES)[keyof typeof RANKING_VIEWER_CLASSES];

interface RankingMetrics {
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
  readonly repositoryCount: number;
  readonly starCount: number;
}

export interface RankingEntry extends RankingMetrics {
  readonly rank: number;

  readonly displayName: string;
  readonly githubLogin: string;
  readonly department: string | null;

  readonly name?: string | null;
  readonly total: number;
}

export interface RankingPage {
  readonly year: RankingYear;
  readonly items: readonly RankingEntry[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;

  readonly dataAsOf: Date | null;
  readonly viewerClass: RankingViewerClass;
  readonly nextCycleAt: Date | null;
}

export function resolveRankingYearFromQuery(
  year: RankingYear | undefined,
  period: LegacyRankingPeriod | undefined,
  now: Date = new Date(),
): RankingYear {
  if (year !== undefined) return year;
  if (period === LEGACY_RANKING_PERIODS.THIS_YEAR) {
    return rankingYearInAsiaSeoul(now);
  }
  if (period === LEGACY_RANKING_PERIODS.ALL) return RANKING_YEAR_ALL;
  return rankingYearInAsiaSeoul(now);
}

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
    const nextCycleAt = CollectionScheduleService.nextScheduledCollectionAt(
      new Date(),
    );

    if (viewerClass !== RANKING_VIEWER_CLASSES.STAFF) {
      return {
        year,
        items: slice.map(toPublicEntry),
        page,
        pageSize,
        total: entries.length,
        dataAsOf,
        viewerClass,
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
      total: activityTotal(row),
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

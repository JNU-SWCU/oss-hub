import { Injectable } from '@nestjs/common';
import { activityTotal } from '../../common/domain/activity-counts';
import { nextScheduledCollectionAt } from '../../github/service/collection-schedule';
import {
  RANKING_VIEWER_CLASSES,
  RANKING_YEAR_ALL,
  type RankingEntry,
  type RankingPage,
  type RankingViewerClass,
  type RankingYear,
} from '../domain/ranking';
import { compareRankingCandidates } from '../domain/ranking-order';
import {
  buildRankingTimeline,
  RANKING_TIMELINE_MIN_YEAR,
  withoutZeroTotalSeries,
  type RankingTimeline,
  type RankingTimelineBuild,
} from '../domain/ranking-timeline';
import { RankingRepository } from '../repository/ranking.repository';

interface RankedPublicEntry extends RankingEntry {
  readonly githubId: bigint;
}

interface TimelineBuild extends RankingTimelineBuild {
  readonly dataAsOf: Date | null;
}

interface TimelineViewer {
  readonly viewerClass: RankingViewerClass;
  readonly githubLogin: string | null;
}

const EMPTY_TIMELINE_BUILD: TimelineBuild = {
  points: [],
  series: [],
  dataAsOf: null,
};

@Injectable()
export class RankingService {
  private readonly inFlightBuilds = new Map<
    string,
    Promise<readonly RankedPublicEntry[]>
  >();
  private readonly inFlightTimelines = new Map<
    string,
    Promise<TimelineBuild>
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
    const nextCycleAt = nextScheduledCollectionAt(new Date());

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

  async findTimeline(
    year: number,
    githubId: bigint | null,
  ): Promise<RankingTimeline> {
    const [viewer, build] = await Promise.all([
      this.resolveTimelineViewer(githubId),
      this.findTimelineBuild(year),
    ]);
    return {
      year,
      viewerClass: viewer.viewerClass,
      viewerGithubLogin: viewer.githubLogin,
      dataAsOf: build.dataAsOf,
      points: build.points,
      series: withoutZeroTotalSeries(build.series, viewer.githubLogin),
    };
  }

  async listYears(): Promise<readonly number[]> {
    return this.ranking.listYears();
  }

  private async resolveTimelineViewer(
    githubId: bigint | null,
  ): Promise<TimelineViewer> {
    const viewerClass = await this.ranking.findViewerClass(githubId);
    if (githubId === null || viewerClass === RANKING_VIEWER_CLASSES.PUBLIC) {
      return { viewerClass, githubLogin: null };
    }
    return {
      viewerClass,
      githubLogin: await this.ranking.findViewerGithubLogin(githubId),
    };
  }

  private async findTimelineBuild(year: number): Promise<TimelineBuild> {
    const cacheKey = `timeline:${year}`;
    const existingBuild = this.inFlightTimelines.get(cacheKey);
    if (existingBuild) return existingBuild;

    const build = this.buildTimeline(year).finally(() =>
      this.inFlightTimelines.delete(cacheKey),
    );
    this.inFlightTimelines.set(cacheKey, build);
    return build;
  }

  private async buildTimeline(year: number): Promise<TimelineBuild> {
    if (year < RANKING_TIMELINE_MIN_YEAR) return EMPTY_TIMELINE_BUILD;

    const [metrics, snapshots, dataAsOf] = await Promise.all([
      this.ranking.findMetrics({ currentYear: year }),
      this.ranking.findMonthlySnapshots(year),
      this.ranking.findDataAsOf(),
    ]);
    return {
      ...buildRankingTimeline({
        year,
        metrics,
        snapshots,
        dataAsOf,
        now: new Date(),
      }),
      dataAsOf,
    };
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
      .sort(compareRankingCandidates)
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

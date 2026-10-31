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
    const envelope = {
      year,
      page,
      pageSize,
      total: entries.length,
      dataAsOf,
      nextCycleAt: nextScheduledCollectionAt(new Date()),
    };

    if (viewerClass !== RANKING_VIEWER_CLASSES.STAFF) {
      return { ...envelope, viewerClass, items: slice.map(toPublicEntry) };
    }

    try {
      return {
        ...envelope,
        viewerClass: RANKING_VIEWER_CLASSES.STAFF,
        items: await this.attachStaffNames(slice),
      };
    } catch {
      return {
        ...envelope,
        viewerClass: RANKING_VIEWER_CLASSES.PUBLIC,
        items: slice.map(toPublicEntry),
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
    return this.singleFlight(this.inFlightTimelines, `timeline:${year}`, () =>
      this.buildTimeline(year),
    );
  }

  private singleFlight<T>(
    inFlight: Map<string, Promise<T>>,
    key: string,
    run: () => Promise<T>,
  ): Promise<T> {
    const existing = inFlight.get(key);
    if (existing) return existing;

    const started = run().finally(() => inFlight.delete(key));
    inFlight.set(key, started);
    return started;
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
    return this.singleFlight(
      this.inFlightBuilds,
      year === RANKING_YEAR_ALL ? RANKING_YEAR_ALL : `year:${year}`,
      () => this.buildPublicEntries(year),
    );
  }

  private async buildPublicEntries(
    year: RankingYear,
  ): Promise<readonly RankedPublicEntry[]> {
    const activity = await this.ranking.findMetrics(
      year === RANKING_YEAR_ALL ? {} : { currentYear: year },
    );

    return activity
      .map((row) => ({ ...row, total: activityTotal(row) }))
      .sort(compareRankingCandidates)
      .map((entry, index) => ({
        ...entry,
        rank: index + 1,
        displayName: entry.githubLogin,
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

import {
  activityTotal,
  type ActivityCounts,
} from '../../common/domain/activity-counts';
import type { RankingViewerClass } from './ranking';
import {
  calendarDateInAsiaSeoul,
  calendarDateInUtc,
  rankingYearInAsiaSeoul,
} from './ranking-event';
import {
  compareRankingCandidates,
  type RankingCandidate,
} from './ranking-order';

export const RANKING_TIMELINE_MIN_YEAR = 2026;

export interface RankingTimelineMetric extends ActivityCounts {
  readonly githubId: bigint;
  readonly githubLogin: string;
}

export interface RankingTimelineSnapshot extends ActivityCounts {
  readonly githubId: bigint;
  readonly snapshotDate: Date;
}

export interface RankingTimelinePoint {
  readonly date: string;
}

export interface RankingTimelineSeries {
  readonly githubLogin: string;
  readonly ranks: readonly (number | null)[];
  readonly totals: readonly (number | null)[];
}

export interface RankingTimelineBuild {
  readonly points: readonly RankingTimelinePoint[];
  readonly series: readonly RankingTimelineSeries[];
}

export interface RankingTimelineBuildInput {
  readonly year: number;
  readonly metrics: readonly RankingTimelineMetric[];
  readonly snapshots: readonly RankingTimelineSnapshot[];
  readonly dataAsOf: Date | null;
  readonly now: Date;
}

export interface RankingTimeline extends RankingTimelineBuild {
  readonly year: number;
  readonly viewerClass: RankingViewerClass;
  readonly viewerGithubLogin: string | null;
  readonly dataAsOf: Date | null;
}

interface SeriesRow {
  readonly metric: RankingTimelineMetric;
  readonly ranks: (number | null)[];
  readonly totals: (number | null)[];
  carried: ActivityCounts | null;
}

interface RankedRow {
  readonly row: SeriesRow;
  readonly candidate: RankingCandidate;
}

interface MonthlyBucket {
  maxDate: Date;
  readonly rows: Map<bigint, RankingTimelineSnapshot>;
}

export function buildRankingTimeline(
  input: RankingTimelineBuildInput,
): RankingTimelineBuild {
  if (input.metrics.length === 0) {
    return { points: [], series: [] };
  }

  const lastDate = resolveLastPointDate(input);
  const rows: readonly SeriesRow[] = input.metrics.map((metric) => ({
    metric,
    ranks: [],
    totals: [],
    carried: null,
  }));
  const buckets = collectMonthlyBuckets(
    input.snapshots,
    new Set(input.metrics.map((metric) => metric.githubId)),
    monthOfCalendarDate(lastDate),
  );

  const points: RankingTimelinePoint[] = [];
  for (const [, bucket] of buckets) {
    points.push(appendSnapshotPoint(rows, bucket));
  }

  const lastRanked = rankRows(
    rows.map((row) => ({
      row,
      candidate: candidateOf(row.metric, row.metric),
    })),
  );
  points.push({ date: lastDate });

  return {
    points,
    series: lastRanked.map(({ row }) => ({
      githubLogin: row.metric.githubLogin,
      ranks: row.ranks,
      totals: row.totals,
    })),
  };
}

export function withoutZeroTotalSeries(
  series: readonly RankingTimelineSeries[],
  viewerGithubLogin: string | null,
): readonly RankingTimelineSeries[] {
  return series.filter(
    (entry) =>
      entry.totals.at(-1) !== 0 || entry.githubLogin === viewerGithubLogin,
  );
}

function appendSnapshotPoint(
  rows: readonly SeriesRow[],
  bucket: MonthlyBucket,
): RankingTimelinePoint {
  const ranked: RankedRow[] = [];
  for (const row of rows) {
    const snapshot = bucket.rows.get(row.metric.githubId);
    if (snapshot !== undefined) {
      row.carried = snapshot;
    }
    const carried = row.carried;
    if (carried === null) {
      row.ranks.push(null);
      row.totals.push(null);
      continue;
    }
    ranked.push({ row, candidate: candidateOf(row.metric, carried) });
  }
  rankRows(ranked);
  return { date: calendarDateInUtc(bucket.maxDate) };
}

function rankRows(ranked: readonly RankedRow[]): readonly RankedRow[] {
  const ordered = [...ranked].sort((left, right) =>
    compareRankingCandidates(left.candidate, right.candidate),
  );
  ordered.forEach((entry, index) => {
    entry.row.ranks.push(index + 1);
    entry.row.totals.push(entry.candidate.total);
  });
  return ordered;
}

function candidateOf(
  metric: RankingTimelineMetric,
  counts: ActivityCounts,
): RankingCandidate {
  return {
    githubId: metric.githubId,
    githubLogin: metric.githubLogin,
    commitCount: counts.commitCount,
    pullRequestCount: counts.pullRequestCount,
    issueCount: counts.issueCount,
    repositoryCount: counts.repositoryCount,
    starCount: counts.starCount,
    total: activityTotal(counts),
  };
}

function collectMonthlyBuckets(
  snapshots: readonly RankingTimelineSnapshot[],
  eligibleGithubIds: ReadonlySet<bigint>,
  lastMonth: number,
): ReadonlyMap<number, MonthlyBucket> {
  const buckets = new Map<number, MonthlyBucket>();
  for (const snapshot of snapshots) {
    if (!eligibleGithubIds.has(snapshot.githubId)) continue;
    const month = snapshot.snapshotDate.getUTCMonth() + 1;
    if (month >= lastMonth) continue;

    const bucket = buckets.get(month) ?? {
      maxDate: snapshot.snapshotDate,
      rows: new Map<bigint, RankingTimelineSnapshot>(),
    };
    bucket.rows.set(snapshot.githubId, snapshot);
    if (bucket.maxDate.getTime() < snapshot.snapshotDate.getTime()) {
      bucket.maxDate = snapshot.snapshotDate;
    }
    buckets.set(month, bucket);
  }
  return new Map([...buckets].sort(([left], [right]) => left - right));
}

function resolveLastPointDate(input: RankingTimelineBuildInput): string {
  if (input.year !== rankingYearInAsiaSeoul(input.now)) {
    return `${input.year}-12-31`;
  }
  return calendarDateInAsiaSeoul(input.dataAsOf ?? input.now);
}

function monthOfCalendarDate(date: string): number {
  return Number(date.slice(5, 7));
}

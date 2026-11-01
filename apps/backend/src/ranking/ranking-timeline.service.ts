import { Injectable } from '@nestjs/common';
import {
  RankingRepository,
  type RankingMetricRow,
  type RankingMonthlySnapshotRow,
} from './ranking.repository';
import { RankingYearService } from './ranking-year.service';

type MonthlyCounts = Omit<RankingMonthlySnapshotRow, 'githubId' | 'month'>;

export interface RankingTimelineSeries {
  readonly githubLogin: string;
  readonly ranks: readonly (number | null)[];
  readonly totals: readonly (number | null)[];
}

export interface RankingTimeline {
  readonly year: number;
  readonly months: readonly number[];
  readonly series: readonly RankingTimelineSeries[];
}

@Injectable()
export class RankingTimelineService {
  private readonly inFlightBuilds = new Map<number, Promise<RankingTimeline>>();

  constructor(
    private readonly ranking: RankingRepository,
    private readonly rankingYear: RankingYearService,
  ) {}

  async findTimelineFromRequest(request: {
    readonly year: string;
  }): Promise<RankingTimeline> {
    const year = Number(request.year);
    const existingBuild = this.inFlightBuilds.get(year);
    if (existingBuild) return existingBuild;

    const build = this.findTimeline(year).finally(() =>
      this.inFlightBuilds.delete(year),
    );
    this.inFlightBuilds.set(year, build);
    return build;
  }

  async findTimeline(
    year: number,
    now: Date = new Date(),
  ): Promise<RankingTimeline> {
    const [members, snapshots] = await Promise.all([
      this.ranking.findMetrics({ currentYear: year }),
      this.ranking.findMonthlySnapshots(year),
    ]);
    const lastMonth =
      this.rankingYear.rankingYearInAsiaSeoul(now) === year
        ? this.rankingYear.rankingMonthInAsiaSeoul(now)
        : 12;

    const byMonth = new Map<number, Map<bigint, MonthlyCounts>>();
    for (const { githubId, month, ...counts } of snapshots) {
      if (month >= lastMonth) continue;
      const rows = byMonth.get(month) ?? new Map<bigint, MonthlyCounts>();
      rows.set(githubId, counts);
      byMonth.set(month, rows);
    }
    const pastMonths = [...byMonth.keys()].sort((left, right) => left - right);

    const carried = new Map<bigint, MonthlyCounts>();
    const pastPoints = pastMonths.map((month) => {
      for (const [githubId, counts] of byMonth.get(month) ?? []) {
        carried.set(githubId, counts);
      }
      return this.rankAt(members, carried);
    });
    const lastPoint = this.rankAt(
      members,
      new Map(members.map((member) => [member.githubId, member])),
    );
    const points = [...pastPoints, lastPoint];

    const series = members
      .filter((member) => (lastPoint.get(member.githubId)?.total ?? 0) > 0)
      .sort(
        (left, right) =>
          (lastPoint.get(left.githubId)?.rank ?? 0) -
          (lastPoint.get(right.githubId)?.rank ?? 0),
      )
      .map((member) => ({
        githubLogin: member.githubLogin,
        ranks: points.map((point) => point.get(member.githubId)?.rank ?? null),
        totals: points.map(
          (point) => point.get(member.githubId)?.total ?? null,
        ),
      }));

    return { year, months: [...pastMonths, lastMonth], series };
  }

  private rankAt(
    members: readonly RankingMetricRow[],
    countsById: ReadonlyMap<bigint, MonthlyCounts>,
  ): ReadonlyMap<bigint, { readonly rank: number; readonly total: number }> {
    const candidates = members.flatMap((member) => {
      const counts = countsById.get(member.githubId);
      if (counts === undefined) return [];
      return [
        {
          ...counts,
          githubId: member.githubId,
          githubLogin: member.githubLogin,
          total: this.rankingYear.activityTotal(counts),
        },
      ];
    });
    candidates.sort((left, right) =>
      this.rankingYear.compareRanked(left, right),
    );
    return new Map(
      candidates.map((candidate, index) => [
        candidate.githubId,
        { rank: index + 1, total: candidate.total },
      ]),
    );
  }
}

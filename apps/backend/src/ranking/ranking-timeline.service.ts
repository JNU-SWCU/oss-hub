import { Injectable } from '@nestjs/common';
import { RankingRepository } from './ranking.repository';
import { RankingYearService } from './ranking-year.service';

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
  private readonly inFlightBuilds = new Map<string, Promise<RankingTimeline>>();

  constructor(
    private readonly ranking: RankingRepository,
    private readonly rankingYear: RankingYearService,
  ) {}

  async findTimelineFromRequest(request: {
    readonly year: string;
    readonly viewer?: string;
  }): Promise<RankingTimeline> {
    const year = Number(request.year);
    const viewer = request.viewer ?? null;
    const key = `${year}:${viewer?.toLowerCase() ?? ''}`;
    const existingBuild = this.inFlightBuilds.get(key);
    if (existingBuild) return existingBuild;

    const build = this.findTimeline(year, viewer).finally(() =>
      this.inFlightBuilds.delete(key),
    );
    this.inFlightBuilds.set(key, build);
    return build;
  }

  async findTimeline(
    year: number,
    viewer: string | null,
    now: Date = new Date(),
  ): Promise<RankingTimeline> {
    const lastMonth =
      this.rankingYear.rankingYearInAsiaSeoul(now) === year
        ? this.rankingYear.rankingMonthInAsiaSeoul(now)
        : 12;
    const { selected, points } = await this.ranking.findTimelineSeries(
      year,
      lastMonth,
      viewer,
    );
    const pastMonths = [...new Set(points.map((point) => point.month))].sort(
      (left, right) => left - right,
    );
    const byMember = new Map<
      string,
      Map<number, { rank: number; total: number }>
    >();
    for (const point of points) {
      if (
        point.githubId === null ||
        point.rank === null ||
        point.total === null
      )
        continue;
      const key = point.githubId.toString();
      const months =
        byMember.get(key) ?? new Map<number, { rank: number; total: number }>();
      months.set(point.month, { rank: point.rank, total: point.total });
      byMember.set(key, months);
    }
    const series = selected.map((member) => {
      const months = byMember.get(member.githubId.toString());
      return {
        githubLogin: member.githubLogin,
        ranks: [
          ...pastMonths.map((month) => months?.get(month)?.rank ?? null),
          member.rank,
        ],
        totals: [
          ...pastMonths.map((month) => months?.get(month)?.total ?? null),
          member.total,
        ],
      };
    });
    return { year, months: [...pastMonths, lastMonth], series };
  }
}

import { Injectable } from '@nestjs/common';
import type { OptionalSessionRequest } from '../auth/http-auth.types';
import { HTTP_AUTH_KINDS } from '../platform/auth.config';
import { RankingRepository } from './ranking.repository';
import { RANKING_YEAR_ALL, RankingYearService } from './ranking-year.service';

export interface RankingTimelineSeries {
  readonly githubLogin: string;
  readonly ranks: readonly (number | null)[];
  readonly totals: readonly (number | null)[];
}

export interface RankingYearTimeline {
  readonly year: number;
  readonly months: readonly number[];
  readonly series: readonly RankingTimelineSeries[];
}

export interface RankingTimelinePeriod {
  readonly fromMonth: string;
  readonly toMonth: string;
}

export interface RankingAllTimeline {
  readonly year: typeof RANKING_YEAR_ALL;
  readonly periods: readonly RankingTimelinePeriod[];
  readonly series: readonly RankingTimelineSeries[];
}

export type RankingTimeline = RankingYearTimeline | RankingAllTimeline;

@Injectable()
export class RankingTimelineService {
  private readonly inFlightBuilds = new Map<string, Promise<RankingTimeline>>();

  constructor(
    private readonly ranking: RankingRepository,
    private readonly rankingYear: RankingYearService,
  ) {}

  async findTimelineFromRequest(
    request: {
      readonly year: string;
      readonly viewer?: string;
    },
    auth: OptionalSessionRequest['auth'],
  ): Promise<RankingTimeline> {
    const year =
      request.year === RANKING_YEAR_ALL
        ? RANKING_YEAR_ALL
        : Number(request.year);
    const viewerGithubId =
      auth.kind === HTTP_AUTH_KINDS.AUTHENTICATED &&
      request.viewer?.toLowerCase() === auth.principal.nickname.toLowerCase()
        ? auth.principal.githubId
        : null;
    const key = `${year}:${viewerGithubId ?? ''}`;
    const existingBuild = this.inFlightBuilds.get(key);
    if (existingBuild) return existingBuild;

    const build = (
      year === RANKING_YEAR_ALL
        ? this.findAllTimeline(viewerGithubId)
        : this.findTimeline(year, viewerGithubId)
    ).finally(() => this.inFlightBuilds.delete(key));
    this.inFlightBuilds.set(key, build);
    return build;
  }

  private async findTimeline(
    year: number,
    viewerGithubId: bigint | null,
  ): Promise<RankingYearTimeline> {
    const now = new Date();
    const lastMonth =
      this.rankingYear.rankingYearInAsiaSeoul(now) === year
        ? this.rankingYear.rankingMonthInAsiaSeoul(now)
        : 12;
    const { selected, points } = await this.ranking.findTimelineSeries(
      year,
      lastMonth,
      viewerGithubId,
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

  private async findAllTimeline(
    viewerGithubId: bigint | null,
  ): Promise<RankingAllTimeline> {
    const rows = await this.ranking.findAllTimelineSeries(viewerGithubId);
    const slots = new Map<
      string,
      {
        readonly period: RankingTimelinePeriod;
        readonly points: Map<
          bigint,
          { githubLogin: string; rank: number; total: number }
        >;
      }
    >();
    for (const {
      fromMonth,
      toMonth,
      githubId,
      githubLogin,
      rank,
      total,
    } of rows) {
      let slot = slots.get(fromMonth);
      if (slot === undefined) {
        slot = { period: { fromMonth, toMonth }, points: new Map() };
        slots.set(fromMonth, slot);
      }
      if (
        githubId !== null &&
        githubLogin !== null &&
        rank !== null &&
        total !== null
      ) {
        slot.points.set(githubId, { githubLogin, rank, total });
      }
    }
    const periods = [...slots.values()];
    const finalPoints = periods.at(-1)?.points ?? [];
    return {
      year: RANKING_YEAR_ALL,
      periods: periods.map(({ period }) => period),
      series: [...finalPoints].map(([githubId, { githubLogin }]) => ({
        githubLogin,
        ranks: periods.map(({ points }) => points.get(githubId)?.rank ?? null),
        totals: periods.map(
          ({ points }) => points.get(githubId)?.total ?? null,
        ),
      })),
    };
  }
}

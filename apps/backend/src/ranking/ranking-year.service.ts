import { Injectable, BadRequestException } from '@nestjs/common';

@Injectable()
export class RankingYearService {
  activityTotal(activity: ActivityCounts): number {
    return (
      activity.commitCount +
      activity.pullRequestCount +
      activity.issueCount +
      activity.repositoryCount +
      activity.starCount
    );
  }

  rankingYearInAsiaSeoul(date: Date): number {
    return new Date(date.getTime() + ASIA_SEOUL_OFFSET_MS).getUTCFullYear();
  }

  rankingYearStartInAsiaSeoul(year: number): Date {
    return new Date(Date.UTC(year, 0, 1) - ASIA_SEOUL_OFFSET_MS);
  }

  resolveRankingYearFromQuery(
    year: RankingYear | undefined,
    period: LegacyRankingPeriod | undefined,
    now: Date = new Date(),
  ): RankingYear {
    if (year !== undefined) return year;
    if (period === LEGACY_RANKING_PERIODS.THIS_YEAR) {
      return this.rankingYearInAsiaSeoul(now);
    }
    if (period === LEGACY_RANKING_PERIODS.ALL) return RANKING_YEAR_ALL;
    return this.rankingYearInAsiaSeoul(now);
  }

  resolveRankingQueryYear(
    query: {
      readonly year?: string;
      readonly period?: LegacyRankingPeriod;
    },
    now: Date = new Date(),
  ): RankingYear {
    return this.resolveRankingYearFromQuery(
      parseYearParam(query.year),
      query.period,
      now,
    );
  }
}

const ASIA_SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;

function parseYearParam(raw: string | undefined): RankingYear | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (raw.toLowerCase() === RANKING_YEAR_ALL) return RANKING_YEAR_ALL;
  const year = Number(raw);
  if (!Number.isInteger(year)) return undefined;

  if (year < RANKING_YEAR_MIN || year > RANKING_YEAR_MAX) {
    throw new BadRequestException(
      `year must be "${RANKING_YEAR_ALL}" or an integer between ${RANKING_YEAR_MIN} and ${RANKING_YEAR_MAX}`,
    );
  }
  return year;
}

export interface ActivityCounts {
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
  readonly repositoryCount: number;
  readonly starCount: number;
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

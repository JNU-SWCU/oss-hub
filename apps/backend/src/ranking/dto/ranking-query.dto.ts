import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import {
  LEGACY_RANKING_PERIODS,
  RANKING_YEAR_ALL,
  type LegacyRankingPeriod,
  type RankingYear,
  resolveRankingYearFromQuery,
} from '../domain/ranking';

/**
 * Query contract for `GET /ranking`.
 * Prefer `year` (`all` | `YYYY`). Legacy `period` (`THIS_YEAR` | `ALL`) still works
 * when `year` is absent — `THIS_YEAR` maps to the Asia/Seoul calendar year.
 */
export class RankingQueryRequestDto {
  /**
   * Preferred filter: `all` or a 4-digit year. Query strings stay strings until
   * `resolveRankingQueryYear()` normalizes them.
   */
  @IsOptional()
  @Matches(/^(all|\d{4})$/i)
  readonly year?: string;

  /**
   * Legacy `THIS_YEAR` | `ALL`. Used only when `year` is absent.
   */
  @IsOptional()
  @IsIn([LEGACY_RANKING_PERIODS.THIS_YEAR, LEGACY_RANKING_PERIODS.ALL])
  readonly period?: LegacyRankingPeriod;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  readonly page: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  readonly pageSize: number = 20;
}

export function resolveRankingQueryYear(
  query: Pick<RankingQueryRequestDto, 'year' | 'period'>,
  now: Date = new Date(),
): RankingYear {
  return resolveRankingYearFromQuery(
    parseYearParam(query.year),
    query.period,
    now,
  );
}

function parseYearParam(raw: string | undefined): RankingYear | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (raw.toLowerCase() === RANKING_YEAR_ALL) return RANKING_YEAR_ALL;
  const year = Number(raw);
  if (Number.isInteger(year)) return year;
  return undefined;
}

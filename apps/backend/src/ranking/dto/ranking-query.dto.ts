import { BadRequestException } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import {
  LEGACY_RANKING_PERIODS,
  RANKING_YEAR_ALL,
  RANKING_YEAR_MAX,
  RANKING_YEAR_MIN,
  type LegacyRankingPeriod,
  type RankingYear,
  resolveRankingYearFromQuery,
} from '../domain/ranking';

const RANKING_YEAR_PARAM_PATTERN = /^(all|20\d{2}|2100)$/i;

export class RankingQueryRequestDto {
  @IsOptional()
  @Matches(RANKING_YEAR_PARAM_PATTERN)
  readonly year?: string;

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
  if (!Number.isInteger(year)) return undefined;

  if (year < RANKING_YEAR_MIN || year > RANKING_YEAR_MAX) {
    throw new BadRequestException(
      `year must be "${RANKING_YEAR_ALL}" or an integer between ${RANKING_YEAR_MIN} and ${RANKING_YEAR_MAX}`,
    );
  }
  return year;
}

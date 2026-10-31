import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { LEGACY_RANKING_PERIODS } from '../ranking-year.service';
import type { LegacyRankingPeriod } from '../ranking-year.service';

const RANKING_YEAR_PARAM_PATTERN = /^(all|20\d{2}|2100)$/i;

export class RankingRequestDto {
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

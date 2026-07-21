import { Type } from 'class-transformer';
import { IsIn, IsInt, Max, Min } from 'class-validator';
import { RANKING_PERIODS, type RankingPeriod } from '../domain/ranking';

export class RankingQueryRequestDto {
  @IsIn([RANKING_PERIODS.THIS_YEAR, RANKING_PERIODS.ALL])
  readonly period: RankingPeriod = RANKING_PERIODS.THIS_YEAR;

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

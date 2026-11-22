import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  INSIGHTS_YEAR_ERROR,
  STAFF_INSIGHTS_FINDER_DIRECTIONS,
  STAFF_INSIGHTS_FINDER_SORTS,
  STAFF_INSIGHTS_RECENT_ACTIVITY,
  type StaffInsightsFinderInput,
  type StaffInsightsFinderQuery,
} from '../staff-insights-query.config';

const MAX_INT = 2_147_483_647;

export class StaffInsightsRequestDto {
  @IsOptional()
  @IsString({ message: INSIGHTS_YEAR_ERROR })
  @IsNotEmpty({ message: INSIGHTS_YEAR_ERROR })
  readonly year?: string;
}

export class StaffInsightsFinderRequestDto
  extends StaffInsightsRequestDto
  implements StaffInsightsFinderInput
{
  @IsOptional()
  @IsString()
  @MaxLength(100)
  readonly search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  readonly department?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  readonly programId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_INT)
  readonly minActivity?: number;

  @ApiPropertyOptional({ enum: STAFF_INSIGHTS_RECENT_ACTIVITY })
  @IsOptional()
  @IsIn(STAFF_INSIGHTS_RECENT_ACTIVITY)
  readonly recentActivity?: StaffInsightsFinderQuery['recentActivity'];

  @ApiPropertyOptional({ enum: STAFF_INSIGHTS_FINDER_SORTS })
  @IsOptional()
  @IsIn(STAFF_INSIGHTS_FINDER_SORTS)
  readonly sort?: StaffInsightsFinderQuery['sort'];

  @ApiPropertyOptional({ enum: STAFF_INSIGHTS_FINDER_DIRECTIONS })
  @IsOptional()
  @IsIn(STAFF_INSIGHTS_FINDER_DIRECTIONS)
  readonly direction?: StaffInsightsFinderQuery['direction'];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_INT)
  readonly page?: number;
}

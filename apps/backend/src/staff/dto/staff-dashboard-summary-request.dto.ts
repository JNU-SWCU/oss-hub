import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { PROGRAM_LIST_QUERY_DIRECTIONS } from '../../programs/program-list.config';
import type { ProgramListQueryDirection } from '../../programs/programs.repository';
import type {
  StaffDashboardSort,
  StaffDashboardStatusFilter,
} from '../../programs/team.repository';

const STAFF_DASHBOARD_STATUSES = [
  'all',
  'recruiting',
  'in_progress',
  'upcoming',
  'ended',
] as const satisfies readonly StaffDashboardStatusFilter[];

const STAFF_DASHBOARD_SORTS = [
  'name',
  'deadline',
  'submission',
  'pending',
] as const satisfies readonly StaffDashboardSort[];

function hasSortParameter(query: StaffDashboardSummaryRequestDto): boolean {
  return query.sort !== undefined || query.direction !== undefined;
}

export class StaffDashboardSummaryRequestDto {
  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readonly page: number = 1;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  readonly pageSize: number = 20;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(100)
  readonly search: string = '';

  @ApiPropertyOptional({ enum: STAFF_DASHBOARD_STATUSES })
  @IsIn(STAFF_DASHBOARD_STATUSES)
  readonly status: StaffDashboardStatusFilter = 'all';

  @ApiPropertyOptional({
    enum: STAFF_DASHBOARD_SORTS,
    description: 'Required when direction is provided.',
  })
  @ValidateIf(hasSortParameter)
  @IsIn(STAFF_DASHBOARD_SORTS)
  declare readonly sort?: StaffDashboardSort;

  @ApiPropertyOptional({
    enum: PROGRAM_LIST_QUERY_DIRECTIONS,
    description: 'Required when sort is provided.',
  })
  @ValidateIf(hasSortParameter)
  @IsIn(PROGRAM_LIST_QUERY_DIRECTIONS)
  declare readonly direction?: ProgramListQueryDirection;
}

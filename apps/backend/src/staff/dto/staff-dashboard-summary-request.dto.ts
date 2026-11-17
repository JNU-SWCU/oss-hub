import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsString, Max, MaxLength, Min } from 'class-validator';
import type { StaffDashboardStatusFilter } from '../../programs/team.repository';

const STAFF_DASHBOARD_STATUSES = [
  'all',
  'recruiting',
  'in_progress',
  'upcoming',
  'ended',
] as const satisfies readonly StaffDashboardStatusFilter[];

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
}

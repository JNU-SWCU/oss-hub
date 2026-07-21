import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Role, RoleRequestStatus } from '@prisma/client';
import type { StaffRoleRequestListQuery } from '../domain/staff-role-request';

export class StaffRoleRequestsQueryDto {
  @IsOptional()
  @IsIn([Role.STAFF])
  declare readonly requestedRole?: typeof Role.STAFF;

  @IsOptional()
  @IsEnum(RoleRequestStatus)
  declare readonly status?: RoleRequestStatus;

  @IsOptional()
  @IsString()
  declare readonly query?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  declare readonly page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  declare readonly limit?: number;

  toQuery(): StaffRoleRequestListQuery {
    return {
      status: this.status ?? RoleRequestStatus.PENDING,
      query: this.query?.trim() ?? '',
      page: this.page ?? 1,
      limit: this.limit ?? 20,
    };
  }
}

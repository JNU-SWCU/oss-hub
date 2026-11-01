import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { AccountStatus } from '@prisma/client';
import type {
  AdminAccessPendingFilter,
  AdminAccessRoleFilter,
  AdminAccessSortDirection,
  AdminAccessSortField,
} from '../../users/admin-access-read-ordering.repository';
import {
  ADMIN_ACCESS_PENDING_FILTERS,
  ADMIN_ACCESS_ROLE_FILTERS,
  ADMIN_ACCESS_SORT_DIRECTIONS,
  ADMIN_ACCESS_SORT_FIELDS,
} from '../../users/admin-access-query.config';

const trim = ({ value }: { readonly value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class AccessRequestsListRequestDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  declare readonly query?: string;

  @IsOptional()
  @IsIn(Object.values(ADMIN_ACCESS_ROLE_FILTERS))
  declare readonly role?: AdminAccessRoleFilter;

  @IsOptional()
  @IsEnum(AccountStatus)
  declare readonly accountStatus?: AccountStatus;

  @IsOptional()
  @IsIn(Object.values(ADMIN_ACCESS_PENDING_FILTERS))
  declare readonly pendingRequest?: AdminAccessPendingFilter;

  @IsOptional()
  @IsIn(Object.values(ADMIN_ACCESS_SORT_FIELDS))
  declare readonly sort?: AdminAccessSortField;

  @IsOptional()
  @IsIn(Object.values(ADMIN_ACCESS_SORT_DIRECTIONS))
  declare readonly direction?: AdminAccessSortDirection;

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
}

export class AccessRequestsHistoryRequestDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  declare readonly staffAccessRequestPage?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  declare readonly staffAccessRequestLimit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  declare readonly loginPage?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  declare readonly loginLimit?: number;
}

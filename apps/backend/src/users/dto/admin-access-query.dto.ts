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
import {
  ADMIN_ACCESS_PENDING_FILTERS,
  ADMIN_ACCESS_ROLE_FILTERS,
  type AdminAccessListQuery,
  type AdminAccessHistoryQuery,
  type AdminAccessPendingFilter,
  type AdminAccessRoleFilter,
} from '../domain/admin-access';

const trim = ({ value }: { readonly value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class AdminAccessListRequestDto {
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

  toQuery(): AdminAccessListQuery {
    return {
      query: this.query ?? '',
      ...(this.role === undefined ? {} : { role: this.role }),
      ...(this.accountStatus === undefined
        ? {}
        : { accountStatus: this.accountStatus }),
      ...(this.pendingRequest === undefined
        ? {}
        : { pendingRequest: this.pendingRequest }),
      page: this.page ?? 1,
      limit: this.limit ?? 20,
    };
  }
}

export class AdminAccessHistoryRequestDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  declare readonly roleRequestPage?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  declare readonly roleRequestLimit?: number;

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

  toQuery(): AdminAccessHistoryQuery {
    return {
      roleRequests: {
        page: this.roleRequestPage ?? 1,
        limit: this.roleRequestLimit ?? 20,
      },
      loginHistory: {
        page: this.loginPage ?? 1,
        limit: this.loginLimit ?? 20,
      },
    };
  }
}

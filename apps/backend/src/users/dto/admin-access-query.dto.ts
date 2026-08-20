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
  ADMIN_ACCESS_DEFAULT_DIRECTION,
  ADMIN_ACCESS_DEFAULT_SORT,
  ADMIN_ACCESS_PENDING_FILTERS,
  ADMIN_ACCESS_ROLE_FILTERS,
  ADMIN_ACCESS_SORT_DIRECTIONS,
  ADMIN_ACCESS_SORT_FIELDS,
  type AdminAccessListQuery,
  type AdminAccessHistoryQuery,
  type AdminAccessPendingFilter,
  type AdminAccessRoleFilter,
  type AdminAccessSortDirection,
  type AdminAccessSortField,
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
      sort: this.sort ?? ADMIN_ACCESS_DEFAULT_SORT,
      direction: this.direction ?? ADMIN_ACCESS_DEFAULT_DIRECTION,
      page: this.page ?? 1,
      limit: this.limit ?? 20,
    };
  }

  /**
   * 가입 신청 큐 — 클라이언트 pendingRequest는 무시하고 항상 PENDING.
   * 기본 정렬은 요청 시각(createdAt desc).
   */
  toRequestQuery(): AdminAccessListQuery {
    return {
      query: this.query ?? '',
      ...(this.role === undefined ? {} : { role: this.role }),
      ...(this.accountStatus === undefined
        ? {}
        : { accountStatus: this.accountStatus }),
      pendingRequest: ADMIN_ACCESS_PENDING_FILTERS.PENDING,
      sort: this.sort ?? ADMIN_ACCESS_SORT_FIELDS.CREATED_AT,
      direction: this.direction ?? ADMIN_ACCESS_SORT_DIRECTIONS.DESC,
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

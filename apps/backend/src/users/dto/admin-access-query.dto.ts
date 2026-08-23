import { BadRequestException } from '@nestjs/common';
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

/**
 * 정본 철자와 legacy 철자가 둘 다 실렸을 때 어떤 값을 쓸 것인가.
 *
 * 같으면 하나를 쓰고, **다르면 거절한다**. 어느 한쪽을 조용히 이기게 하면 관리자가
 * 본 페이지와 서버가 센 페이지가 갈라지고, 그 갈라짐은 화면에 아무 징후도 남기지
 * 않는다. 모호한 입력을 추측하는 대신 400으로 되돌리는 편이 안전하다.
 *
 * 이 중복 철자는 **bridge 전용**이다. 직전 프런트엔드 번들(v0.6.110)이
 * `roleRequestPage`/`roleRequestLimit`을 보내고, 전역 `ValidationPipe`가
 * `forbidNonWhitelisted: true`라 모르는 키를 받으면 **요청 전체가 400**이 된다.
 * 다음 contract PR이 직전 번들이 사라진 뒤 legacy 쪽을 걷어낸다.
 */
function reconcileDualSpelling(
  canonical: number | undefined,
  legacy: number | undefined,
  field: string,
): number | undefined {
  if (canonical !== undefined && legacy !== undefined && canonical !== legacy) {
    throw new BadRequestException(
      `${field}와 legacy 별칭에 서로 다른 값이 실렸습니다.`,
    );
  }
  return canonical ?? legacy;
}

export class AdminAccessHistoryRequestDto {
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

  /**
   * bridge 전용 legacy 별칭. 정본 철자와 똑같은 검증을 걸어 어느 쪽으로 들어와도
   * 같은 경계를 지나게 한다 — legacy라고 검증을 느슨하게 하면 그쪽이 우회로가 된다.
   */
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
      staffAccessRequests: {
        page:
          reconcileDualSpelling(
            this.staffAccessRequestPage,
            this.roleRequestPage,
            'staffAccessRequestPage',
          ) ?? 1,
        limit:
          reconcileDualSpelling(
            this.staffAccessRequestLimit,
            this.roleRequestLimit,
            'staffAccessRequestLimit',
          ) ?? 20,
      },
      loginHistory: {
        page: this.loginPage ?? 1,
        limit: this.loginLimit ?? 20,
      },
    };
  }
}

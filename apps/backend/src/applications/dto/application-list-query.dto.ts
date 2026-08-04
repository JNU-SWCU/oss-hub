import { Type } from 'class-transformer';
import {
  Allow,
  IsIn,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import {
  APPLICATION_LIST_STATUSES,
  type ApplicationListQuery,
  type ApplicationListStatus,
} from '../application-list-query';

export class ApplicationListQueryRequestDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readonly page: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  readonly pageSize: number = 20;

  @IsString()
  @MaxLength(100)
  readonly search: string = '';

  @IsIn(APPLICATION_LIST_STATUSES)
  readonly status: ApplicationListStatus = 'all';

  /**
   * D6: 개인/팀 mode 필터 폐지. 전역 ValidationPipe가 whitelist+forbidNonWhitelisted
   * 이라 선언을 지우면 구 클라이언트의 `?mode=` 가 400이 된다. 값은 수용만 하고
   * toQuery()에는 넣지 않는다.
   */
  @Allow()
  readonly mode?: unknown;

  toQuery(): ApplicationListQuery {
    return {
      page: this.page,
      pageSize: this.pageSize,
      search: this.search.trim(),
      status: this.status,
    };
  }
}

import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import {
  PROGRAM_LIST_QUERY_DIRECTIONS,
  PROGRAM_LIST_QUERY_SORTS,
  PROGRAM_LIST_QUERY_STATUSES,
  type ProgramListQuery,
  type ProgramListQueryDirection,
  type ProgramListQuerySort,
  type ProgramListQueryStatus,
} from '../program-list-query';

export class ProgramListQueryRequestDto {
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

  @IsIn(PROGRAM_LIST_QUERY_STATUSES)
  readonly status: ProgramListQueryStatus = 'all';

  /** 생략하면 변경 전과 동일한 순서(모집중 우선)를 그대로 낸다. */
  @IsOptional()
  @IsIn(PROGRAM_LIST_QUERY_SORTS)
  readonly sort?: ProgramListQuerySort;

  @IsOptional()
  @IsIn(PROGRAM_LIST_QUERY_DIRECTIONS)
  readonly direction?: ProgramListQueryDirection;

  toQuery(): ProgramListQuery {
    return {
      page: this.page,
      pageSize: this.pageSize,
      search: this.search.trim(),
      status: this.status,
      sort: this.sort,
      direction: this.direction,
    };
  }
}

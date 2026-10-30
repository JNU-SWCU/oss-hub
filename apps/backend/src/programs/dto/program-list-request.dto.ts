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
} from '../programs.policy';

export class ProgramListRequestDto {
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

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  readonly year?: number;

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
      year: this.year,
      sort: this.sort,
      direction: this.direction,
    };
  }
}

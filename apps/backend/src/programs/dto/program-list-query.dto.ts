import { Type } from 'class-transformer';
import { IsIn, IsInt, IsString, Max, MaxLength, Min } from 'class-validator';

import {
  PROGRAM_LIST_QUERY_STATUSES,
  type ProgramListQuery,
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

  toQuery(): ProgramListQuery {
    return {
      page: this.page,
      pageSize: this.pageSize,
      search: this.search.trim(),
      status: this.status,
    };
  }
}

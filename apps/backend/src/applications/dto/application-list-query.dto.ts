import { Type } from 'class-transformer';
import { IsIn, IsInt, IsString, Max, MaxLength, Min } from 'class-validator';

import {
  APPLICATION_LIST_MODES,
  APPLICATION_LIST_STATUSES,
  type ApplicationListMode,
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

  @IsIn(APPLICATION_LIST_MODES)
  readonly mode: ApplicationListMode = 'all';

  toQuery(): ApplicationListQuery {
    return {
      page: this.page,
      pageSize: this.pageSize,
      search: this.search.trim(),
      status: this.status,
      mode: this.mode,
    };
  }
}

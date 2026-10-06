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
  APPLICATION_LIST_VIEWS,
  type ApplicationListQuery,
  type ApplicationListStatus,
  type ApplicationListView,
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

  @IsIn(APPLICATION_LIST_VIEWS)
  readonly view: ApplicationListView = 'default';

  @Allow()
  readonly mode?: unknown;

  toQuery(): ApplicationListQuery {
    return {
      page: this.page,
      pageSize: this.pageSize,
      search: this.search.trim(),
      status: this.status,
      view: this.view,
    };
  }
}

import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { BoardPostListQuery } from '../domain/board-post-list-query';

export class BoardPostListRequestDto {
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

  toQuery(): BoardPostListQuery {
    return { page: this.page ?? 1, limit: this.limit ?? 20 };
  }
}

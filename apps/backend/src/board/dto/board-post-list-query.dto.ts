import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export interface BoardPostListQuery {
  readonly page: number;
  readonly limit: number;
}

/** `GET /programs/:programId/board/posts` 쿼리 — 미지정 시 1페이지·20건. */
export class BoardPostListQueryDto {
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

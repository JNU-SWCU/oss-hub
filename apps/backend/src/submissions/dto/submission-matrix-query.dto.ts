import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import {
  MATRIX_APPLICATION_MODES,
  type MatrixApplicationMode,
  type SubmissionMatrixQuery,
} from '../domain/submission-matrix';

export const MATRIX_DEFAULT_PAGE_SIZE = 20;
export const MATRIX_MAX_PAGE_SIZE = 100;

export class SubmissionMatrixQueryRequestDto {
  @IsOptional()
  @IsString()
  declare readonly q?: string;

  @IsOptional()
  @IsIn(MATRIX_APPLICATION_MODES)
  declare readonly applicationMode?: MatrixApplicationMode;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  declare readonly page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MATRIX_MAX_PAGE_SIZE)
  declare readonly pageSize?: number;

  toQuery(): SubmissionMatrixQuery {
    return {
      q: this.q?.trim() ?? '',
      applicationMode: this.applicationMode ?? null,
      page: this.page ?? 1,
      pageSize: this.pageSize ?? MATRIX_DEFAULT_PAGE_SIZE,
    };
  }
}

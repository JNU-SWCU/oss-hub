import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { type MatrixApplicationMode } from '../submission-matrix.repository';
import { MATRIX_APPLICATION_MODES } from '../submission-matrix.config';
const MATRIX_MAX_PAGE_SIZE = 100;

export class SubmissionMatrixRequestDto {
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
}

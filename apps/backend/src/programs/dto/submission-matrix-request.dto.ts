import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import type {
  MatrixApplicationMode,
  MatrixCellStatus,
  MatrixSort,
  MatrixSortDirection,
} from '../submissions.repository';
import {
  MATRIX_APPLICATION_MODES,
  MATRIX_CELL_STATUSES,
} from '../submission-matrix.config';
const MATRIX_MAX_PAGE_SIZE = 100;
const MATRIX_SORT_PATTERN = /^(?:team|progress|milestone:\S+)$/u;

export class SubmissionMatrixRequestDto {
  @IsOptional()
  @IsString()
  declare readonly q?: string;

  @IsOptional()
  @IsIn(MATRIX_APPLICATION_MODES)
  declare readonly applicationMode?: MatrixApplicationMode;

  @IsOptional()
  @IsIn(MATRIX_CELL_STATUSES)
  declare readonly status?: MatrixCellStatus;

  @ApiPropertyOptional({ type: String, pattern: MATRIX_SORT_PATTERN.source })
  @IsOptional()
  @Matches(MATRIX_SORT_PATTERN)
  declare readonly sort?: MatrixSort;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  declare readonly direction?: MatrixSortDirection;

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

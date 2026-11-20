import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { type DocumentDeliveryStatus } from '../requirements.repository';
import {
  type RequirementCollectionFilter,
  type RequirementCollectionSort,
  REQUIREMENT_COLLECTION_FILTERS,
  REQUIREMENT_COLLECTION_SORTS,
} from '../requirement-archive.service';
import type {
  MatrixCellStatus,
  MatrixSortDirection,
} from '../submissions.repository';
import { MATRIX_CELL_STATUSES } from '../submission-matrix.config';
const REQUIREMENT_COLLECTION_MAX_PAGE_SIZE = 100;

export class RequirementCollectionRequestDto {
  @IsOptional()
  @IsIn(['all'])
  declare readonly scope?: 'all';

  @IsOptional()
  @IsString()
  declare readonly q?: string;

  @IsOptional()
  @IsIn(MATRIX_CELL_STATUSES)
  declare readonly status?: MatrixCellStatus;

  @IsOptional()
  @IsIn(REQUIREMENT_COLLECTION_SORTS)
  declare readonly sort?: RequirementCollectionSort;

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
  @Max(REQUIREMENT_COLLECTION_MAX_PAGE_SIZE)
  declare readonly pageSize?: number;

  @IsOptional()
  @IsIn(REQUIREMENT_COLLECTION_FILTERS)
  declare readonly filter?: RequirementCollectionFilter;

  @IsOptional()
  @IsIn(['MISSING', 'LATE', 'COMPLETE', 'NO_REQUIRED_ITEMS'])
  declare readonly deliveryStatus?: DocumentDeliveryStatus;

  @ValidateIf(
    (query: RequirementCollectionRequestDto) =>
      query.documentId !== undefined || query.submissionState !== undefined,
  )
  @IsString()
  @IsNotEmpty()
  declare readonly documentId?: string;

  @IsOptional()
  @IsIn(['ALL', 'SUBMITTED', 'MISSING'])
  declare readonly submissionState?: 'ALL' | 'SUBMITTED' | 'MISSING';
}

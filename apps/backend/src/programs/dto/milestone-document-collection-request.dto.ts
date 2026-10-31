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
import { type DocumentDeliveryStatus } from '../milestone-document-collection-read.repository';
import type { MilestoneDocumentCollectionFilter } from '../milestone-document-rules.service';
import { MILESTONE_DOCUMENT_COLLECTION_FILTERS } from '../milestone-document-rules.service';
const MILESTONE_DOCUMENT_COLLECTION_MAX_PAGE_SIZE = 100;

export class MilestoneDocumentCollectionRequestDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  declare readonly page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MILESTONE_DOCUMENT_COLLECTION_MAX_PAGE_SIZE)
  declare readonly pageSize?: number;

  @IsOptional()
  @IsIn(MILESTONE_DOCUMENT_COLLECTION_FILTERS)
  declare readonly filter?: MilestoneDocumentCollectionFilter;

  @IsOptional()
  @IsIn(['MISSING', 'LATE', 'COMPLETE', 'NO_REQUIRED_ITEMS'])
  declare readonly deliveryStatus?: DocumentDeliveryStatus;

  @ValidateIf(
    (query: MilestoneDocumentCollectionRequestDto) =>
      query.documentId !== undefined || query.submissionState !== undefined,
  )
  @IsString()
  @IsNotEmpty()
  declare readonly documentId?: string;

  @IsOptional()
  @IsIn(['ALL', 'SUBMITTED', 'MISSING'])
  declare readonly submissionState?: 'ALL' | 'SUBMITTED' | 'MISSING';
}

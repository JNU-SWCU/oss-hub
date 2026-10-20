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
import {
  MILESTONE_DOCUMENT_COLLECTION_FILTERS,
  type MilestoneDocumentCollectionFilter,
} from '../domain/milestone-document-collection-query';
import type { DocumentDeliveryStatus } from '../../submissions/domain/document-delivery-status';
import type { MilestoneDocumentDeliveryQuery } from '../domain/milestone-document-delivery-page';

const MILESTONE_DOCUMENT_COLLECTION_DEFAULT_PAGE_SIZE = 20;
const MILESTONE_DOCUMENT_COLLECTION_MAX_PAGE_SIZE = 100;

export class MilestoneDocumentCollectionQueryRequestDto {
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
    (query: MilestoneDocumentCollectionQueryRequestDto) =>
      query.documentId !== undefined || query.submissionState !== undefined,
  )
  @IsString()
  @IsNotEmpty()
  declare readonly documentId?: string;

  @IsOptional()
  @IsIn(['ALL', 'SUBMITTED', 'MISSING'])
  declare readonly submissionState?: 'ALL' | 'SUBMITTED' | 'MISSING';

  toQuery(): MilestoneDocumentDeliveryQuery {
    return {
      page: this.page ?? 1,
      pageSize:
        this.pageSize ?? MILESTONE_DOCUMENT_COLLECTION_DEFAULT_PAGE_SIZE,
      filter: this.filter ?? 'ALL',
      ...(this.documentId === undefined
        ? {}
        : {
            document: {
              id: this.documentId,
              submissionState: this.submissionState ?? 'ALL',
            },
          }),
      ...(this.deliveryStatus === undefined
        ? {}
        : { deliveryStatus: this.deliveryStatus }),
    };
  }
}

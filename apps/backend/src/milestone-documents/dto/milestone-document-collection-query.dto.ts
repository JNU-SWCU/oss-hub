import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  MILESTONE_DOCUMENT_COLLECTION_FILTERS,
  type MilestoneDocumentCollectionFilter,
} from '../domain/milestone-document-collection-query';
import type { DocumentDeliveryStatus } from '../../submissions/document-delivery-status';
import type { MilestoneDocumentDeliveryQuery } from '../milestone-document-delivery-page';

export const MILESTONE_DOCUMENT_COLLECTION_DEFAULT_PAGE_SIZE = 20;
export const MILESTONE_DOCUMENT_COLLECTION_MAX_PAGE_SIZE = 100;

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

  toQuery(): MilestoneDocumentDeliveryQuery {
    return {
      page: this.page ?? 1,
      pageSize:
        this.pageSize ?? MILESTONE_DOCUMENT_COLLECTION_DEFAULT_PAGE_SIZE,
      filter: this.filter ?? 'ALL',
      ...(this.deliveryStatus === undefined
        ? {}
        : { deliveryStatus: this.deliveryStatus }),
    };
  }
}

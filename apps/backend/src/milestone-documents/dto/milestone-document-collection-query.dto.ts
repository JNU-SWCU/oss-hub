import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  MILESTONE_DOCUMENT_COLLECTION_FILTERS,
  type MilestoneDocumentCollectionFilter,
  type MilestoneDocumentCollectionQuery,
} from '../domain/milestone-document-collection-query';

export const MILESTONE_DOCUMENT_COLLECTION_DEFAULT_PAGE_SIZE = 20;
export const MILESTONE_DOCUMENT_COLLECTION_MAX_PAGE_SIZE = 100;

/**
 * `GET /milestones/:milestoneId/documents/collection` 쿼리 — ADR-004의 「모든 목록 조회는
 * 페이지네이션을 제공한다」 계약을 따른다. 검증 관례는 submissions/dto/submission-matrix-query.dto.ts를
 * 그대로 따른다(같은 종류의 표를 두 벌의 규칙으로 만들지 않는다).
 */
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

  toQuery(): MilestoneDocumentCollectionQuery {
    return {
      page: this.page ?? 1,
      pageSize:
        this.pageSize ?? MILESTONE_DOCUMENT_COLLECTION_DEFAULT_PAGE_SIZE,
      filter: this.filter ?? 'ALL',
    };
  }
}

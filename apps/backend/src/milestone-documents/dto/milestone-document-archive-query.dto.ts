import { IsIn, IsOptional } from 'class-validator';
import {
  MILESTONE_DOCUMENT_ARCHIVE_GROUPINGS,
  type MilestoneDocumentArchiveGrouping,
} from '../domain/milestone-document-archive';

/**
 * `GET /milestones/:milestoneId/documents/collection/archive` 쿼리.
 *
 * ⚠ 수합 표와 달리 **`page`·`pageSize`·`filter`를 받지 않는다.** 받는 것처럼 열어 두면
 * 「필수 서류 미제출」로 걸러 놓고 받은 ZIP을 그 팀들만 담긴 것으로 읽게 되는데, 이 기능은
 * 언제나 마일스톤 전체를 담는다. 있지도 않은 조작을 계약에 남기지 않는다.
 */
export class MilestoneDocumentArchiveQueryRequestDto {
  @IsOptional()
  @IsIn(MILESTONE_DOCUMENT_ARCHIVE_GROUPINGS)
  declare readonly groupBy?: MilestoneDocumentArchiveGrouping;

  toGrouping(): MilestoneDocumentArchiveGrouping {
    return this.groupBy ?? 'TEAM';
  }
}

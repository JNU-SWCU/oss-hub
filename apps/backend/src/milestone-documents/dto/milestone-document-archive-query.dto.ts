import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { DomainException } from '../../common/error-code';
import {
  MILESTONE_DOCUMENT_ARCHIVE_GROUPINGS,
  type MilestoneDocumentArchiveGrouping,
} from '../domain/milestone-document-archive';
import type { MilestoneDocumentArchiveScope } from '../milestone-document-archive.service';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from '../milestone-documents-error-code.enum';

/**
 * `GET /milestones/:milestoneId/documents/collection/archive` 쿼리.
 *
 * ⚠ 수합 표와 달리 **`page`·`pageSize`·`filter`를 받지 않는다.** 받는 것처럼 열어 두면
 * 「필수 서류 미제출」로 걸러 놓고 받은 ZIP을 그 팀들만 담긴 것으로 읽게 되는데, 이 기능은
 * 언제나 **전 팀**을 담는다. 있지도 않은 조작을 계약에 남기지 않는다.
 *
 * 받는 것은 둘이고 **서로 배타적**이다.
 * - `groupBy` — 전체를 받을 때 폴더를 무엇으로 묶을지(팀별·서류별)
 * - `documentId` — **서류 한 종류만** 전 팀 것으로 좁힌다(ADR-004의 「리소스 부분집합은 query
 *   parameter로」). 좁힌 ZIP은 폴더 없이 평평하다.
 */
export class MilestoneDocumentArchiveQueryRequestDto {
  @IsOptional()
  @IsIn(MILESTONE_DOCUMENT_ARCHIVE_GROUPINGS)
  declare readonly groupBy?: MilestoneDocumentArchiveGrouping;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  declare readonly documentId?: string;

  /**
   * ⚠ 둘을 함께 받으면 **막는다**(400).
   *
   * 조용히 한쪽을 무시하지 않는 이유: 서류 하나짜리 ZIP에는 묶는 방식이 없는데
   * `groupBy=DOCUMENT`를 보낸 사람은 「서류별로 묶어 받았다」고 믿는다. 무시하면 그 오해가
   * 응답으로 확인되지 않은 채 남는다. 되돌려 주는 편이 정직하다.
   */
  toScope(): MilestoneDocumentArchiveScope {
    if (this.documentId === undefined) {
      return { kind: 'ALL', grouping: this.groupBy ?? 'TEAM' };
    }
    if (this.groupBy !== undefined) {
      throw new DomainException(
        MILESTONE_DOCUMENTS_ERROR_CODES[
          MilestoneDocumentsErrorCode.INVALID_REQUEST
        ],
      );
    }
    return { kind: 'DOCUMENT', documentId: this.documentId };
  }
}

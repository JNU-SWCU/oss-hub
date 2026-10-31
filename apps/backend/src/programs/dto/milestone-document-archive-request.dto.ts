import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { DomainException } from '../../platform/error-code.error';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from '../milestone-documents-error-code.error';
import {
  MILESTONE_DOCUMENT_ARCHIVE_GROUPINGS,
  type MilestoneDocumentArchiveGrouping,
  type MilestoneDocumentArchiveScope,
} from '../milestone-document-archive.service';

export class MilestoneDocumentArchiveRequestDto {
  @IsOptional()
  @IsIn(MILESTONE_DOCUMENT_ARCHIVE_GROUPINGS)
  declare readonly groupBy?: MilestoneDocumentArchiveGrouping;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  declare readonly documentId?: string;

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

import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  MILESTONE_DOCUMENT_ARCHIVE_GROUPINGS,
  type MilestoneDocumentArchiveGrouping,
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
}

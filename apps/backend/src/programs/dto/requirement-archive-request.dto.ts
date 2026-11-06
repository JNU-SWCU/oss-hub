import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  REQUIREMENT_ARCHIVE_GROUPINGS,
  type RequirementArchiveGrouping,
} from '../requirement-archive.service';

export class RequirementArchiveRequestDto {
  @IsOptional()
  @IsIn(REQUIREMENT_ARCHIVE_GROUPINGS)
  declare readonly groupBy?: RequirementArchiveGrouping;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  declare readonly documentId?: string;
}

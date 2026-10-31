import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { type ProgramDocumentArchiveScope } from '../milestone-document-archive.service';

export class ProgramDocumentArchiveRequestDto {
  @IsIn(['PROGRAM', 'MILESTONE', 'TEAM'])
  declare readonly scope: ProgramDocumentArchiveScope['kind'];

  @IsOptional()
  @IsIn(['TEAM', 'DOCUMENT'])
  declare readonly groupBy?: 'TEAM' | 'DOCUMENT';

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  declare readonly milestoneId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  declare readonly teamId?: string;
}

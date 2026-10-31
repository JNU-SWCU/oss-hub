import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { type ProgramDocumentChangeRequestScope } from '../milestone-document-collection-read.repository';

export class CreateProgramDocumentChangeRequestRequestDto {
  @IsIn(['PROGRAM', 'TEAM'])
  declare readonly scope: ProgramDocumentChangeRequestScope['kind'];

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  declare readonly teamId?: string | null;

  @IsBoolean()
  declare readonly includeFinalDecisions: boolean;

  @IsString()
  @MaxLength(2_000)
  declare readonly comment: string;

  @IsISO8601()
  declare readonly resubmissionDueAt: string;

  @Matches(/^[0-9a-f]{64}$/)
  declare readonly expectedVersion: string;
}

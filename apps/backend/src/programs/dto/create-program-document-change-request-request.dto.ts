import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { type ProgramDocumentChangeRequestScope } from '../requirements.repository';
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
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  declare readonly comment?: string;
  @Matches(/^[0-9a-f]{64}$/)
  declare readonly expectedVersion: string;
}

import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  type ProgramDocumentChangeRequestScope,
  toProgramDocumentChangeRequestScope,
} from '../milestone-document.policy';

export class ProgramDocumentChangeRequestTargetsRequestDto {
  @IsIn(['PROGRAM', 'TEAM'])
  declare readonly scope: ProgramDocumentChangeRequestScope['kind'];

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  declare readonly teamId?: string | null;

  toScope(): ProgramDocumentChangeRequestScope {
    return toProgramDocumentChangeRequestScope(this.scope, this.teamId);
  }
}

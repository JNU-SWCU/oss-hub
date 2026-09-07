import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { DomainException } from '../../common/error-code';
import type { ProgramDocumentArchiveScope } from '../milestone-document-archive.service';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from '../milestone-documents-error-code.enum';

/** Scope is explicit: a missing selector must never widen a team download to a program. */
export class ProgramDocumentArchiveQueryRequestDto {
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

  toScope(): ProgramDocumentArchiveScope {
    if (
      this.scope === 'PROGRAM' &&
      this.milestoneId === undefined &&
      this.teamId === undefined
    ) {
      return { kind: 'PROGRAM', ...this.grouping() };
    }
    if (
      this.scope === 'MILESTONE' &&
      this.milestoneId !== undefined &&
      this.teamId === undefined
    ) {
      return {
        kind: 'MILESTONE',
        milestoneId: this.milestoneId,
        ...this.grouping(),
      };
    }
    if (
      this.scope === 'TEAM' &&
      this.teamId !== undefined &&
      this.milestoneId === undefined
    ) {
      return { kind: 'TEAM', teamId: this.teamId, ...this.grouping() };
    }
    throw new DomainException(
      MILESTONE_DOCUMENTS_ERROR_CODES[
        MilestoneDocumentsErrorCode.INVALID_REQUEST
      ],
    );
  }

  private grouping(): { readonly grouping?: 'TEAM' | 'DOCUMENT' } {
    return this.groupBy === undefined ? {} : { grouping: this.groupBy };
  }
}

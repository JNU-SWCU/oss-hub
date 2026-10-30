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
import { DomainException } from '../../platform/error-code.error';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from '../milestone-documents-error-code.error';
import {
  type ProgramDocumentChangeRequestInput,
  type ProgramDocumentChangeRequestScope,
  toProgramDocumentChangeRequestScope,
} from '../milestone-document.policy';

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

  toInput(): ProgramDocumentChangeRequestInput {
    const comment = this.comment.trim();
    if (comment === '') {
      throw new DomainException(
        MILESTONE_DOCUMENTS_ERROR_CODES[
          MilestoneDocumentsErrorCode.REVIEW_COMMENT_REQUIRED
        ],
      );
    }
    const resubmissionDueAt = new Date(this.resubmissionDueAt);
    if (Number.isNaN(resubmissionDueAt.getTime())) {
      throw new DomainException(
        MILESTONE_DOCUMENTS_ERROR_CODES[
          MilestoneDocumentsErrorCode.RESUBMISSION_DUE_AT_REQUIRED
        ],
      );
    }
    return {
      scope: toProgramDocumentChangeRequestScope(this.scope, this.teamId),
      includeFinalDecisions: this.includeFinalDecisions,
      comment,
      resubmissionDueAt,
      expectedVersion: this.expectedVersion,
    };
  }
}

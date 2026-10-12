import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { DomainException } from '../../common/error-code';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from '../domain/milestone-documents-error-code.enum';
import type {
  ProgramDocumentChangeRequestInput,
  ProgramDocumentChangeRequestScope,
  ProgramDocumentChangeRequestTargetCounts,
} from '../domain/program-document-change-request';

function toScope(
  scope: ProgramDocumentChangeRequestScope['kind'],
  teamId: string | undefined,
): ProgramDocumentChangeRequestScope {
  if (scope === 'PROGRAM' && teamId === undefined) return { kind: 'PROGRAM' };
  if (scope === 'TEAM' && teamId !== undefined) return { kind: 'TEAM', teamId };
  throw new DomainException(
    MILESTONE_DOCUMENTS_ERROR_CODES[
      MilestoneDocumentsErrorCode.INVALID_REQUEST
    ],
  );
}

export class ProgramDocumentChangeRequestTargetsQueryRequestDto {
  @IsIn(['PROGRAM', 'TEAM'])
  declare readonly scope: ProgramDocumentChangeRequestScope['kind'];

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  declare readonly teamId?: string;

  toScope(): ProgramDocumentChangeRequestScope {
    return toScope(this.scope, this.teamId);
  }
}

export class CreateProgramDocumentChangeRequestRequestDto {
  @IsIn(['PROGRAM', 'TEAM'])
  declare readonly scope: ProgramDocumentChangeRequestScope['kind'];

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  declare readonly teamId?: string;

  @IsBoolean()
  declare readonly includeFinalDecisions: boolean;

  @IsString()
  @MaxLength(2_000)
  declare readonly comment: string;

  @IsISO8601()
  declare readonly resubmissionDueAt: string;

  @IsInt()
  @Min(1)
  declare readonly expectedCount: number;

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
      scope: toScope(this.scope, this.teamId),
      includeFinalDecisions: this.includeFinalDecisions,
      comment,
      resubmissionDueAt,
      expectedCount: this.expectedCount,
    };
  }
}

export class ProgramDocumentChangeRequestTargetsResponseDto {
  private constructor(
    readonly submitted: number,
    readonly changesRequested: number,
    readonly approved: number,
    readonly rejected: number,
  ) {}

  static from(
    counts: ProgramDocumentChangeRequestTargetCounts,
  ): ProgramDocumentChangeRequestTargetsResponseDto {
    return new ProgramDocumentChangeRequestTargetsResponseDto(
      counts.SUBMITTED,
      counts.CHANGES_REQUESTED,
      counts.APPROVED,
      counts.REJECTED,
    );
  }
}

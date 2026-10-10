import { ReviewDecision } from '@prisma/client';
import {
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { DomainException } from '../../common/error-code';
import type { CreateMilestoneDocumentReviewInput } from '../domain/milestone-document-review';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from '../domain/milestone-documents-error-code.enum';

export class CreateMilestoneDocumentReviewRequestDto {
  @IsEnum(ReviewDecision)
  declare readonly decision: ReviewDecision;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  declare readonly comment?: string;

  @IsOptional()
  @IsISO8601()
  declare readonly resubmissionDueAt?: string;

  @IsInt()
  @Min(1)
  declare readonly expectedRevision: number;

  @ValidateIf((_, value) => value !== null)
  @IsString()
  declare readonly expectedLatestReviewId: string | null;

  toInput(): CreateMilestoneDocumentReviewInput {
    const comment = this.comment?.trim() || null;
    const version = {
      expectedRevision: this.expectedRevision,
      expectedLatestReviewId: this.expectedLatestReviewId,
    };
    switch (this.decision) {
      case ReviewDecision.APPROVED:
        return {
          decision: this.decision,
          comment,
          resubmissionDueAt: null,
          ...version,
        };
      case ReviewDecision.CHANGES_REQUESTED:
      case ReviewDecision.REJECTED: {
        if (comment === null) {
          throw new DomainException(
            MILESTONE_DOCUMENTS_ERROR_CODES[
              MilestoneDocumentsErrorCode.REVIEW_COMMENT_REQUIRED
            ],
          );
        }
        if (this.decision === ReviewDecision.REJECTED) {
          return {
            decision: this.decision,
            comment,
            resubmissionDueAt: null,
            ...version,
          };
        }

        const resubmissionDueAt =
          this.resubmissionDueAt === undefined
            ? null
            : new Date(this.resubmissionDueAt);
        if (
          resubmissionDueAt === null ||
          Number.isNaN(resubmissionDueAt.getTime())
        ) {
          throw new DomainException(
            MILESTONE_DOCUMENTS_ERROR_CODES[
              MilestoneDocumentsErrorCode.RESUBMISSION_DUE_AT_REQUIRED
            ],
          );
        }
        return {
          decision: this.decision,
          comment,
          resubmissionDueAt,
          ...version,
        };
      }
    }
  }
}

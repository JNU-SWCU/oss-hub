import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { SUBMISSION_REVIEW_EVENTS } from '../submission-history.config';
import type { SubmissionReviewDecision } from '../submissions.repository';
export class CreateRequirementReviewRequestDto {
  @IsIn(SUBMISSION_REVIEW_EVENTS)
  declare readonly decision: SubmissionReviewDecision;
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  declare readonly comment?: string;
  @IsInt()
  @Min(1)
  declare readonly expectedRevision: number;
  @ValidateIf((_, value) => value !== null)
  @IsString()
  declare readonly expectedLatestReviewId: string | null;
}

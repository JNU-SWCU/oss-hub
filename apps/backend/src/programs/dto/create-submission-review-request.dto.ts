import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { SUBMISSION_REVIEW_EVENTS } from '../submission-history.config';
import type { SubmissionReviewDecision } from '../submissions.repository';

export class CreateSubmissionReviewRequestDto {
  @IsInt()
  @Min(1)
  declare readonly revision: number;

  @IsIn(SUBMISSION_REVIEW_EVENTS)
  declare readonly decision: SubmissionReviewDecision;

  @IsOptional()
  @IsString()
  declare readonly comment?: string;
}

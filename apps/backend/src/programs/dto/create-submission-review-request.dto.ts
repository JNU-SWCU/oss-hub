import { ReviewDecision } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateSubmissionReviewRequestDto {
  @IsInt()
  @Min(1)
  declare readonly revision: number;

  @IsEnum(ReviewDecision)
  declare readonly decision: ReviewDecision;

  @IsOptional()
  @IsString()
  declare readonly comment?: string;
}

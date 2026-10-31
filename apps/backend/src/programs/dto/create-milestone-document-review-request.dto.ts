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
}

import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RequirementFeedbackRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  declare readonly cursor?: string;
}

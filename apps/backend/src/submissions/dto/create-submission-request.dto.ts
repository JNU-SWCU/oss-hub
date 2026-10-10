import { Type } from 'class-transformer';
import {
  IsDefined,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  type CreateSubmissionInput,
  parseSubmissionContent,
  type ResubmitSubmissionInput,
} from '../domain/submission-content';

class SubmissionContentRequestDto {
  @IsString()
  declare readonly type: string;

  @IsOptional()
  @IsString()
  declare readonly fileId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  declare readonly text?: string;
}

export class CreateSubmissionRequestDto {
  @IsString()
  @IsNotEmpty()
  declare readonly applicationId: string;

  @IsString()
  @IsNotEmpty()
  declare readonly milestoneId: string;

  @ValidateNested()
  @IsDefined()
  @IsObject()
  @Type(() => SubmissionContentRequestDto)
  declare readonly content: SubmissionContentRequestDto;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  declare readonly comment?: string;

  toInput(): CreateSubmissionInput {
    return {
      applicationId: this.applicationId,
      milestoneId: this.milestoneId,
      content: parseSubmissionContent(this.content),
      comment: this.comment?.trim() || null,
    };
  }
}

export class CreateResubmissionRequestDto {
  @IsInt()
  @Min(1)
  declare readonly baseRevision: number;

  @ValidateNested()
  @IsDefined()
  @IsObject()
  @Type(() => SubmissionContentRequestDto)
  declare readonly content: SubmissionContentRequestDto;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  declare readonly comment?: string;

  toInput(): ResubmitSubmissionInput {
    return {
      baseRevision: this.baseRevision,
      content: parseSubmissionContent(this.content),
      comment: this.comment?.trim() || null,
    };
  }
}

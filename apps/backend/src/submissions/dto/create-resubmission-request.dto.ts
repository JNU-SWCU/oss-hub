import { Type } from 'class-transformer';
import {
  IsDefined,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  parseSubmissionContent,
  type ResubmitSubmissionInput,
} from '../domain/submission-content';
import { SubmissionContentRequestDto } from './create-submission-request.dto';

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

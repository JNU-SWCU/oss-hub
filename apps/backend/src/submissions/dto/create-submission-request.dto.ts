import { Type } from 'class-transformer';
import {
  IsDefined,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  type CreateSubmissionInput,
  parseSubmissionContent,
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

  @IsOptional()
  @IsString()
  @MaxLength(2_048)
  declare readonly releaseUrl?: string;
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

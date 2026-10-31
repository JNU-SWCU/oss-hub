import { Type } from 'class-transformer';
import {
  IsDefined,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { type MilestoneDocumentContentInput } from '../milestone-document-collection-read.repository';
import { parseMilestoneDocumentContent } from '../milestone-documents.service';

export class MilestoneDocumentSubmissionContentRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  declare readonly fileId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  declare readonly text?: string;
}

export class CreateMilestoneDocumentSubmissionRequestDto {
  @ValidateNested()
  @IsDefined()
  @IsObject()
  @Type(() => MilestoneDocumentSubmissionContentRequestDto)
  declare readonly content: MilestoneDocumentSubmissionContentRequestDto;

  toInput(): MilestoneDocumentContentInput {
    return parseMilestoneDocumentContent(this.content);
  }
}

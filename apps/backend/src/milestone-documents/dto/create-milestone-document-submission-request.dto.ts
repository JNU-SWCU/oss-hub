import { Type } from 'class-transformer';
import {
  IsDefined,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  type MilestoneDocumentContentInput,
  parseMilestoneDocumentContent,
} from '../domain/milestone-document-content';

/** submissions/dto/create-submission-request.dto.ts의 SubmissionContentRequestDto와 같은 계약. */
export class MilestoneDocumentSubmissionContentRequestDto {
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

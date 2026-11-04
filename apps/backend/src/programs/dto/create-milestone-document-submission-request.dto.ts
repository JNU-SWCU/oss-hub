import { Type } from 'class-transformer';
import {
  IsDefined,
  IsObject,
  IsOptional,
  IsString,
  IsInt,
  Min,
  MaxLength,
  ValidateNested,
} from 'class-validator';

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
  @IsOptional()
  @IsInt()
  @Min(0)
  declare readonly expectedRevision?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  declare readonly comment?: string | null;

  @ValidateNested()
  @IsDefined()
  @IsObject()
  @Type(() => MilestoneDocumentSubmissionContentRequestDto)
  declare readonly content: MilestoneDocumentSubmissionContentRequestDto;
}

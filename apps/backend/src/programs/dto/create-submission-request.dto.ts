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
}

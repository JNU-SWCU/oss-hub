import { Type } from 'class-transformer';
import {
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class ProgramExternalCoverRequestDto {
  @IsString()
  @MaxLength(2048)
  declare readonly sourceUrl: string;

  @IsString()
  @MaxLength(2048)
  declare readonly imageUrl: string;
}

export class ProgramCoverRequestDto {
  @IsOptional()
  @IsString()
  @Matches(/^\S+$/u)
  @MaxLength(128)
  declare readonly coverUploadId?: string | null;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ProgramExternalCoverRequestDto)
  declare readonly externalCover?: ProgramExternalCoverRequestDto | null;
}

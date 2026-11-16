import { ProgramTrackType } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { type CreateProgramCommand } from '../programs.service';
import {
  PROGRAM_ORGANIZER_MAX_LENGTH,
  PROGRAM_ORGANIZERS_MAX_COUNT,
} from '../program-organizers.config';

export class CreateProgramRequestDto implements CreateProgramCommand {
  @IsString()
  @IsNotEmpty()
  declare name: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PROGRAM_ORGANIZERS_MAX_COUNT)
  @IsString({ each: true })
  @MaxLength(PROGRAM_ORGANIZER_MAX_LENGTH, { each: true })
  declare organizers: string[];

  @IsEnum(ProgramTrackType)
  declare trackType: ProgramTrackType;

  @IsString()
  declare applicationStartAt: string;

  @IsString()
  declare applicationEndAt: string;

  @IsDateString({ strict: true, strictSeparator: true })
  declare startAt: string;

  @IsDateString({ strict: true, strictSeparator: true })
  declare endAt: string;

  @IsOptional()
  @IsInt()
  declare teamMinSize?: number | null;

  @IsOptional()
  @IsInt()
  declare teamMaxSize?: number | null;

  @IsString()
  @IsNotEmpty()
  declare description: string;
}

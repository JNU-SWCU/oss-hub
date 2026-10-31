import { ProgramTrackType } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { type CreateProgramCommand } from '../program-creation.service';

export class CreateProgramRequestDto implements CreateProgramCommand {
  @IsString()
  @IsNotEmpty()
  declare name: string;

  @IsString()
  @IsNotEmpty()
  declare organizer: string;

  @IsEnum(ProgramTrackType)
  declare trackType: ProgramTrackType;

  @IsString()
  declare applicationStartAt: string;

  @IsString()
  declare applicationEndAt: string;

  @IsOptional()
  @IsDateString({ strict: true, strictSeparator: true })
  declare startAt?: string;

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

import { ProgramTrackType } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class UpdateProgramRequestDto {
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

  @IsOptional()
  @IsString()
  declare endAt?: string | null;

  @IsBoolean()
  declare repositoryProvisioningEnabled: boolean;

  @IsBoolean()
  declare notifyOnDeadline: boolean;

  @IsString()
  @IsNotEmpty()
  declare description: string;

  @IsOptional()
  @IsInt()
  declare teamMinSize?: number | null;

  @IsOptional()
  @IsInt()
  declare teamMaxSize?: number | null;
}

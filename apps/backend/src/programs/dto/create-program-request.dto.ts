import { ProgramCategory } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateProgramRequestDto {
  @IsString()
  @IsNotEmpty()
  declare name: string;

  @IsString()
  @IsNotEmpty()
  declare organizer: string;

  @IsEnum(ProgramCategory)
  declare category: ProgramCategory;

  @IsString()
  declare applicationStartAt: string;

  @IsString()
  declare applicationEndAt: string;

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

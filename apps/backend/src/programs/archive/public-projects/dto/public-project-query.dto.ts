import { ProgramCategory } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class PublicProjectQueryRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  readonly pageId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  readonly pageSize: number = 20;

  /** 프로그램 분류 필터. 없으면 전체. */
  @IsOptional()
  @IsEnum(ProgramCategory)
  readonly category?: ProgramCategory;
}

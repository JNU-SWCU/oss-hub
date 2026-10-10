import {
  PUBLIC_PROJECT_YEAR_MIN,
  PUBLIC_PROJECT_YEAR_MAX,
} from '../domain/public-project-query';
import { Type } from 'class-transformer';
import {
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

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(PUBLIC_PROJECT_YEAR_MIN)
  @Max(PUBLIC_PROJECT_YEAR_MAX)
  readonly year?: number;
}

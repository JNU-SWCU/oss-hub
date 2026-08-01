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
}

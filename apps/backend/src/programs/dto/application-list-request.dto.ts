import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  Allow,
  IsIn,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { type ApplicationListStatus } from '../team.repository';
import { APPLICATION_LIST_STATUSES } from '../applications.config';

export class ApplicationListRequestDto {
  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readonly page: number = 1;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  readonly pageSize: number = 20;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(100)
  readonly search: string = '';

  @ApiPropertyOptional()
  @IsIn(APPLICATION_LIST_STATUSES)
  readonly status: ApplicationListStatus = 'all';

  @ApiPropertyOptional({ type: String, deprecated: true })
  @Allow()
  readonly view?: unknown;

  @ApiPropertyOptional({ type: String, deprecated: true })
  @Allow()
  readonly mode?: unknown;
}

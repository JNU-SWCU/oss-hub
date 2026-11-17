import { Transform, Type } from 'class-transformer';
import { AUDIT_CATEGORIES } from '../../platform/audit-source.config';
import type { AuditCategory } from '../../platform/audit-source.config';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class AuditLogListRequestDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  declare readonly q?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  declare readonly action?: string;

  @IsOptional()
  @IsIn(AUDIT_CATEGORIES)
  declare readonly category?: AuditCategory;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true, strictSeparator: true })
  declare readonly from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true, strictSeparator: true })
  declare readonly to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  declare readonly page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  declare readonly limit?: number;
}

import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
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

export type AuditLogListQueryRequestDto = {
  readonly actor?: string;
  readonly action?: string;
  readonly from?: string;
  readonly to?: string;
  readonly page: number;
  readonly limit: number;
};

export class AuditLogListRequestDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  declare readonly actor?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  declare readonly action?: string;

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

  toQuery(): AuditLogListQueryRequestDto {
    return {
      ...(this.actor === undefined ? {} : { actor: this.actor }),
      ...(this.action === undefined ? {} : { action: this.action }),
      ...(this.from === undefined ? {} : { from: this.from }),
      ...(this.to === undefined ? {} : { to: this.to }),
      page: this.page ?? 1,
      limit: this.limit ?? 20,
    };
  }
}

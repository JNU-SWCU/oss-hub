import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class MilestoneDocumentHistoryQueryRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  declare readonly cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  declare readonly limit?: number;

  toQuery(): { readonly cursor: string | null; readonly limit: number } {
    return { cursor: this.cursor ?? null, limit: this.limit ?? 20 };
  }
}

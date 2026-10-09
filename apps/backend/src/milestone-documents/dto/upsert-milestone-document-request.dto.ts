import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import type { UpsertMilestoneDocumentInput } from '../domain/milestone-document-record';

export class UpsertMilestoneDocumentRequestDto {
  @Transform(({ value }) => {
    const input: unknown = value;
    return typeof input === 'string' ? input.trim() : input;
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  declare readonly name: string;

  @IsBoolean()
  declare readonly required: boolean;

  @IsInt()
  @Min(0)
  declare readonly sortOrder: number;

  toInput(): UpsertMilestoneDocumentInput {
    return {
      name: this.name,
      required: this.required,
      sortOrder: this.sortOrder,
    };
  }
}

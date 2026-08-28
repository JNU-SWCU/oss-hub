import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import type { UpsertMilestoneDocumentInput } from '../milestone-documents.repository';

/** 교직원 서류 항목 생성/수정 요청 본문 — 두 endpoint가 같은 shape을 공유한다(전체 교체 방식). */
export class UpsertMilestoneDocumentRequestDto {
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
      name: this.name.trim(),
      required: this.required,
      sortOrder: this.sortOrder,
    };
  }
}

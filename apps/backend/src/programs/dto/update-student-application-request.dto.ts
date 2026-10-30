import { Type } from 'class-transformer';
import { IsDefined, IsInt, IsObject } from 'class-validator';
import type { UpdateStudentApplicationInput } from '../application-records.types';

export class UpdateStudentApplicationRequestDto {
  @IsDefined()
  @IsObject()
  declare readonly answers: Readonly<Record<string, unknown>>;

  @Type(() => Number)
  @IsInt()
  declare readonly applicationTemplateVersion: number;

  toInput(): UpdateStudentApplicationInput {
    return {
      answers: this.answers,
      applicationTemplateVersion: this.applicationTemplateVersion,
    };
  }
}

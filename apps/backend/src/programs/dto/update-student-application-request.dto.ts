import { Type } from 'class-transformer';
import { IsDefined, IsInt, IsObject } from 'class-validator';

export class UpdateStudentApplicationRequestDto {
  @IsDefined()
  @IsObject()
  declare readonly answers: Readonly<Record<string, unknown>>;

  @Type(() => Number)
  @IsInt()
  declare readonly applicationTemplateVersion: number;
}

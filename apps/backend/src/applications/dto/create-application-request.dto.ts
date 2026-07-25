import { Type } from 'class-transformer';
import {
  IsDefined,
  IsInt,
  IsObject,
  IsString,
  ValidateIf,
} from 'class-validator';
import type { CreateApplicationInput } from '../domain/create-application';

export class CreateApplicationRequestDto {
  @IsDefined()
  @IsObject()
  declare readonly answers: Readonly<Record<string, unknown>>;

  /** 개인형은 null, 팀형은 team id. undefined는 null로 정규화한다. */
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  declare readonly teamId: string | null;

  @Type(() => Number)
  @IsInt()
  declare readonly applicationTemplateVersion: number;

  toInput(): CreateApplicationInput {
    return {
      answers: this.answers,
      teamId: this.teamId ?? null,
      applicationTemplateVersion: this.applicationTemplateVersion,
    };
  }
}

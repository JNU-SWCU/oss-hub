import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsInt,
  IsObject,
  IsOptional,
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

  /** 저장소 공개 예정 선택(#414 DEC-33/34). 미지정(구 클라이언트)은 true로 취급한다. */
  @IsOptional()
  @IsBoolean()
  declare readonly isRepositoryPublicationPlanned?: boolean;

  toInput(): CreateApplicationInput {
    return {
      answers: this.answers,
      teamId: this.teamId ?? null,
      applicationTemplateVersion: this.applicationTemplateVersion,
      isRepositoryPublicationPlanned:
        this.isRepositoryPublicationPlanned ?? true,
    };
  }
}

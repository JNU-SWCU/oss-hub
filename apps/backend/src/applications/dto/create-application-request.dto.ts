import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import type { CreateApplicationInput } from '../domain/create-application';

export class CreateApplicationRequestDto {
  @IsDefined()
  @IsObject()
  declare readonly answers: Readonly<Record<string, unknown>>;

  /** 선택. 미입력·공백이면 신청자 표시명 기반 기본 팀 이름을 쓴다. Team.name MaxLength(100). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  declare readonly teamName?: string | null;

  @Type(() => Number)
  @IsInt()
  declare readonly applicationTemplateVersion: number;

  /** 저장소 공개 예정 선택(#414 DEC-33/34). 미지정(구 클라이언트)은 true로 취급한다. */
  @IsOptional()
  @IsBoolean()
  declare readonly isRepositoryPublicationPlanned?: boolean;

  toInput(): CreateApplicationInput {
    const trimmedTeamName = this.teamName?.trim();

    return {
      answers: this.answers,
      teamName:
        trimmedTeamName !== undefined && trimmedTeamName.length > 0
          ? trimmedTeamName
          : null,
      applicationTemplateVersion: this.applicationTemplateVersion,
      isRepositoryPublicationPlanned:
        this.isRepositoryPublicationPlanned ?? true,
    };
  }
}

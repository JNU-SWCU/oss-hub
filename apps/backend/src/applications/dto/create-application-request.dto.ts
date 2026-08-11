import { RepositoryConnectionMode } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Validate,
} from 'class-validator';
import type { CreateApplicationInput } from '../domain/create-application';
import { RepositoryUrlByConnectionModeConstraint } from '../validation/repository-url-by-connection-mode.validator';

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

  /**
   * 저장소 연결 방식. 프로그램의 발급 설정과 함께 service가 최종 판정한다.
   * 제출 시 1회 결정.
   */
  @IsOptional()
  @IsEnum(RepositoryConnectionMode)
  declare readonly repositoryConnectionMode?: RepositoryConnectionMode;

  /**
   * OWN이면 정확한 GitHub 저장소 URL이 필수이고, NEW이면 값이 오면 거부한다.
   * 제출 시 1회 결정.
   */
  @Validate(RepositoryUrlByConnectionModeConstraint)
  declare readonly repositoryUrl?: string | null;

  toInput(): CreateApplicationInput {
    const repositoryConnectionMode = this.repositoryConnectionMode ?? null;
    const repositoryUrl =
      repositoryConnectionMode === RepositoryConnectionMode.OWN
        ? (this.repositoryUrl ?? null)
        : null;
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
      repositoryConnectionMode,
      repositoryUrl,
    };
  }
}

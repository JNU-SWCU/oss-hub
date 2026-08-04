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
  Validate,
  ValidateIf,
} from 'class-validator';
import type { CreateApplicationInput } from '../domain/create-application';
import { RepositoryUrlByConnectionModeConstraint } from '../validation/repository-url-by-connection-mode.validator';

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

  /**
   * 저장소 연결 방식. 미지정(구 클라이언트)은 NEW로 취급한다.
   * 제출 시 1회 결정.
   */
  @IsOptional()
  @IsEnum(RepositoryConnectionMode)
  declare readonly repositoryConnectionMode?: RepositoryConnectionMode;

  /**
   * OWN이면 필수 https URL, NEW이면 값이 오면 거부. 미지정(구 클라이언트)은 null.
   * 제출 시 1회 결정.
   */
  @Validate(RepositoryUrlByConnectionModeConstraint)
  declare readonly repositoryUrl?: string | null;

  toInput(): CreateApplicationInput {
    const repositoryConnectionMode =
      this.repositoryConnectionMode ?? RepositoryConnectionMode.NEW;
    const repositoryUrl =
      repositoryConnectionMode === RepositoryConnectionMode.OWN
        ? (this.repositoryUrl ?? null)
        : null;

    return {
      answers: this.answers,
      teamId: this.teamId ?? null,
      applicationTemplateVersion: this.applicationTemplateVersion,
      isRepositoryPublicationPlanned:
        this.isRepositoryPublicationPlanned ?? true,
      repositoryConnectionMode,
      repositoryUrl,
    };
  }
}

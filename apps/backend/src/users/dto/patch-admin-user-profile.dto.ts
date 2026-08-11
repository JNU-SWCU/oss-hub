import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  USER_DEPARTMENT_MAX_LENGTH,
  USER_NAME_MAX_LENGTH,
} from '../domain/user-profile';
import type { AdminProfileUpdateCommand } from '../domain/admin-profile';

function trimString({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/**
 * 관리자가 다른 사용자의 프로필을 고치는 PATCH 본문 — `UpdateMyProfileRequestDto`와
 * 달리 세 항목 모두 선택이고 실린 항목만 바뀐다(부분 갱신). 형식 검증
 * (`@Matches`/`@MaxLength`)은 본인 경로와 같은 규칙을 그대로 쓴다 — 다른 것은
 * "이미 값이 있는 학번을 바꿀 수 있는가"뿐이고, 그 불변 규칙 우회는 서비스 계층
 * (`admin-profile-mutation.service.ts`)이 담당한다.
 */
export class PatchAdminUserProfileRequestDto {
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(USER_NAME_MAX_LENGTH)
  declare readonly name?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @Matches(/^\d{6}$/, { message: '학번은 숫자 6자리로 입력해 주세요.' })
  declare readonly studentId?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(USER_DEPARTMENT_MAX_LENGTH)
  declare readonly department?: string;

  toCommand(): AdminProfileUpdateCommand {
    return {
      ...(typeof this.name === 'string' ? { name: this.name } : {}),
      ...(typeof this.studentId === 'string'
        ? { studentId: this.studentId }
        : {}),
      ...(typeof this.department === 'string'
        ? { department: this.department }
        : {}),
    };
  }
}

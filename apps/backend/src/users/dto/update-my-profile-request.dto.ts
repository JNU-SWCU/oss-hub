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
import type { PatchUserProfileInput } from '../domain/user-profile';

export { USER_DEPARTMENT_MAX_LENGTH, USER_NAME_MAX_LENGTH };

function trimString({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/**
 * 본인 프로필 쓰기 DTO — 이름·학과는 항상 필수, 학번은 있을 때만 형식을 본다.
 *
 * POST(가입 마치기)와 PATCH(설정 갱신)가 같은 본문을 쓴다. 스크립트가 이름만
 * 보내 학과를 null로 남기는 구멍을 여기서 막는다. 학번 필수 여부는 역할을 아는
 * 서비스가 판정한다 — DTO는 역할을 모른다.
 */
export class UpdateMyProfileRequestDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(USER_NAME_MAX_LENGTH)
  declare readonly name: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @Matches(/^\d{6}$/, { message: '학번은 숫자 6자리로 입력해 주세요.' })
  declare readonly studentId?: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(USER_DEPARTMENT_MAX_LENGTH)
  declare readonly department: string;

  toInput(): PatchUserProfileInput {
    return {
      name: this.name,
      ...(typeof this.studentId === 'string'
        ? { studentId: this.studentId }
        : {}),
      department: this.department,
    };
  }
}

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
 * 단일 permissive DTO — 이름만 필수, 학번·학과는 있을 때만 형식을 검증한다.
 *
 * 어떤 항목이 실제로 필요한지는 역할마다 다르고(#439) DTO는 역할을 모른다.
 * 그래서 형식 검증만 여기서 하고, 필수 여부·완료 판정은 서비스 정책이 담당한다.
 * 관리자는 이름만, 교직원은 이름·학과만 보내므로 학과에 `@IsOptional()`이 붙는다
 * — 키가 없으면 기존 값을 유지하고, 빈 문자열로 지우는 것은 계속 막는다.
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
  @Matches(/^\d{6,10}$/)
  declare readonly studentId?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(USER_DEPARTMENT_MAX_LENGTH)
  declare readonly department?: string;

  toInput(): PatchUserProfileInput {
    return {
      name: this.name,
      ...(typeof this.studentId === 'string'
        ? { studentId: this.studentId }
        : {}),
      ...(typeof this.department === 'string'
        ? { department: this.department }
        : {}),
    };
  }
}

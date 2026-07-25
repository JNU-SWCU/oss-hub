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
 * 단일 permissive DTO — name·department 필수, studentId는 있을 때만 형식 검증.
 * 완료/미완료 분기는 서비스 정책이 담당한다.
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

  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(USER_DEPARTMENT_MAX_LENGTH)
  declare readonly department: string;

  toInput(): PatchUserProfileInput {
    return {
      name: this.name,
      department: this.department,
      ...(typeof this.studentId === 'string'
        ? { studentId: this.studentId }
        : {}),
    };
  }
}

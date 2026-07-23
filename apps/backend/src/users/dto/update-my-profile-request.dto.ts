import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import {
  USER_DEPARTMENT_MAX_LENGTH,
  USER_NAME_MAX_LENGTH,
} from '../domain/user-profile';
import type { CompleteUserProfileInput } from '../domain/user-profile';

export { USER_DEPARTMENT_MAX_LENGTH, USER_NAME_MAX_LENGTH };

function trimString({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class UpdateMyProfileRequestDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(USER_NAME_MAX_LENGTH)
  declare readonly name: string;

  @Transform(trimString)
  @IsString()
  @Matches(/^\d{6,10}$/)
  declare readonly studentId: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(USER_DEPARTMENT_MAX_LENGTH)
  declare readonly department: string;

  toInput(): CompleteUserProfileInput {
    return {
      name: this.name,
      studentId: this.studentId,
      department: this.department,
    };
  }
}

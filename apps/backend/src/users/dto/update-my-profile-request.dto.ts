import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches } from 'class-validator';
import type { CompleteUserProfileInput } from '../domain/user-profile';

function trimString({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class UpdateMyProfileRequestDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  declare readonly name: string;

  @Transform(trimString)
  @IsString()
  @Matches(/^\d{6,10}$/)
  declare readonly studentId: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  declare readonly department: string;

  toInput(): CompleteUserProfileInput {
    return {
      name: this.name,
      studentId: this.studentId,
      department: this.department,
    };
  }
}

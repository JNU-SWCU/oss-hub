import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches } from 'class-validator';
import type { AdminProfileUpdateCommand } from '../admin-profile.types';
import {
  isValidDepartment,
  isValidUserName,
} from '../user-profile-record.policy';
import {
  IsProfileText,
  transformProfileText,
  trimString,
} from '../profile-text-transform.policy';

export class PatchAdminUserProfileRequestDto {
  @IsOptional()
  @Transform(transformProfileText)
  @IsString()
  @IsProfileText('isValidUserName', isValidUserName)
  declare readonly name?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @Matches(/^\d{6}$/, { message: '학번은 숫자 6자리로 입력해 주세요.' })
  declare readonly studentId?: string;

  @IsOptional()
  @Transform(transformProfileText)
  @IsString()
  @IsProfileText('isValidDepartment', isValidDepartment)
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

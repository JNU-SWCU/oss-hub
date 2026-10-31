import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, ValidateBy } from 'class-validator';
import type { AdminProfileUpdateCommand } from '../../users/admin-profile-mutation.service';
import { PROFILE_TEXT_PATTERN } from '../../users/profile-validation.config';

export class PatchAdminUserProfileRequestDto {
  @IsOptional()
  @Transform(transformProfileText)
  @IsString()
  @IsProfileText('isValidUserName')
  declare readonly name?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @Matches(/^\d{6}$/, { message: '학번은 숫자 6자리로 입력해 주세요.' })
  declare readonly studentId?: string;

  @IsOptional()
  @Transform(transformProfileText)
  @IsString()
  @IsProfileText('isValidDepartment')
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

function trimString({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function transformProfileText({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim().normalize('NFC') : value;
}

function isProfileText(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    PROFILE_TEXT_PATTERN.test(value.trim().normalize('NFC'))
  );
}

function IsProfileText(name: string): PropertyDecorator {
  return ValidateBy({ name, validator: { validate: isProfileText } });
}

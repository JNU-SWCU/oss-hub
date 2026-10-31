import { Transform } from 'class-transformer';
import { AffiliationKind } from '@prisma/client';
import {
  IsOptional,
  IsString,
  Matches,
  ValidateIf,
  ValidateBy,
} from 'class-validator';
import { DomainException } from '../../platform/error-code.error';
import { SystemErrorCode } from '../../platform/system-error-code.error';
import {
  USER_DEPARTMENT_MAX_LENGTH,
  USER_NAME_MAX_LENGTH,
  PROFILE_TEXT_PATTERN,
} from '../profile-validation.config';
import { type PatchUserProfileInput } from '../users.service';

export { USER_DEPARTMENT_MAX_LENGTH, USER_NAME_MAX_LENGTH };

export class UpdateMyProfileRequestDto {
  @Transform(transformProfileText)
  @IsString()
  @IsProfileText('isValidUserName')
  declare readonly name: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @Matches(/^\d{6}$/, { message: '학번은 숫자 6자리로 입력해 주세요.' })
  declare readonly studentId?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{10,11}$/, {
    message: '연락처는 숫자 10~11자리로 입력해 주세요.',
  })
  declare readonly phone?: string;

  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  )
  @Transform(transformStaffNumber)
  @IsString()
  @IsProfileText('isValidStaffNumber')
  declare readonly staffNumber?: string | null;

  @ValidateIf(
    (request: UpdateMyProfileRequestDto) =>
      request.affiliationKind === undefined &&
      request.affiliationName === undefined,
  )
  @Transform(transformProfileText)
  @IsString()
  @IsProfileText('isValidDepartment')
  declare readonly department?: string;

  @ValidateIf(
    (request: UpdateMyProfileRequestDto) => request.department === undefined,
  )
  @IsString()
  declare readonly affiliationKind?: string;

  @ValidateIf(
    (request: UpdateMyProfileRequestDto) => request.department === undefined,
  )
  @Transform(transformProfileText)
  @IsString()
  @IsProfileText('isValidAffiliationName')
  declare readonly affiliationName?: string;

  toInput(): PatchUserProfileInput {
    return {
      name: this.name,
      ...(typeof this.studentId === 'string'
        ? { studentId: this.studentId }
        : {}),
      ...(typeof this.department === 'string'
        ? { department: this.department }
        : {}),
      ...(typeof this.phone === 'string' ? { phone: this.phone } : {}),
      ...(this.staffNumber !== undefined
        ? { staffNumber: this.staffNumber }
        : {}),
      ...(typeof this.affiliationKind === 'string'
        ? { affiliationKind: parseAffiliationKind(this.affiliationKind) }
        : {}),
      ...(typeof this.affiliationName === 'string'
        ? { affiliationName: this.affiliationName }
        : {}),
    };
  }
}

function transformStaffNumber({ value }: { value: unknown }): unknown {
  const normalized = transformProfileText({ value });
  return normalized === '' ? null : normalized;
}

function parseAffiliationKind(value: string): AffiliationKind {
  switch (value) {
    case AffiliationKind.DEPARTMENT:
    case AffiliationKind.PROGRAM_OFFICE:
      return value;
    default:
      throw new DomainException({
        code: SystemErrorCode.VALIDATION_FAILED,
        status: 400,
        message: '지원하지 않는 소속 유형입니다.',
      });
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

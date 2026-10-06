import { Transform } from 'class-transformer';
import { AffiliationKind } from '@prisma/client';
import { IsOptional, IsString, Matches, ValidateIf } from 'class-validator';
import { DomainException } from '../../common/error-code';
import { SystemErrorCode } from '../../common/system-error-code.enum';
import { isValidStaffNumber } from '../domain/member-kind';
import {
  isValidDepartment,
  isValidUserName,
  type PatchUserProfileInput,
  USER_DEPARTMENT_MAX_LENGTH,
  USER_NAME_MAX_LENGTH,
} from '../domain/user-profile';
import {
  IsProfileText,
  transformProfileText,
  trimString,
} from './profile-text-transform';

export { USER_DEPARTMENT_MAX_LENGTH, USER_NAME_MAX_LENGTH };

export class UpdateMyProfileRequestDto {
  @Transform(transformProfileText)
  @IsString()
  @IsProfileText('isValidUserName', isValidUserName)
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
  @IsProfileText('isValidStaffNumber', isValidStaffNumber)
  declare readonly staffNumber?: string | null;

  @ValidateIf(
    (request: UpdateMyProfileRequestDto) =>
      request.affiliationKind === undefined &&
      request.affiliationName === undefined,
  )
  @Transform(transformProfileText)
  @IsString()
  @IsProfileText('isValidDepartment', isValidDepartment)
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
  @IsProfileText('isValidAffiliationName', isValidDepartment)
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

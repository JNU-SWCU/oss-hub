import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsString,
  Matches,
  ValidateIf,
} from 'class-validator';
import { DomainException } from '../../common/error-code';
import { SystemErrorCode } from '../../common/system-error-code.enum';
import {
  MEMBER_KINDS,
  normalizeStaffNumber,
  type MemberKindMutationCommand,
  isValidStaffNumber,
} from '../domain/member-kind';
import { isValidDepartment } from '../domain/user-profile-policy';
import {
  IsProfileText,
  transformProfileText,
  trimString,
} from './profile-text-transform';

export class PatchMemberKindRequestDto {
  @IsDefined()
  @IsString()
  declare readonly memberKind: string;

  @IsDefined()
  @IsString()
  declare readonly expectedMemberKind: string;

  @IsDefined()
  @IsBoolean()
  declare readonly expectedHasStaffAccess: boolean;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(trimString)
  @IsString()
  @Matches(/^\d{6}$/, { message: '학번은 숫자 6자리로 입력해 주세요.' })
  declare readonly studentId?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(transformProfileText)
  @IsString()
  @IsProfileText('isValidDepartment', isValidDepartment)
  declare readonly department?: string;

  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  )
  @Transform(transformStaffNumber)
  @IsString()
  @IsProfileText('isValidStaffNumber', isValidStaffNumber)
  declare readonly staffNumber?: string | null;

  toCommand(): MemberKindMutationCommand {
    return {
      memberKind: parseMemberKind(this.memberKind),
      expectedMemberKind: parseMemberKind(this.expectedMemberKind),
      expectedHasStaffAccess: parseExpectedStaffAccess(
        this.expectedHasStaffAccess,
      ),
      ...(this.studentId !== undefined ? { studentId: this.studentId } : {}),
      ...(this.department !== undefined ? { department: this.department } : {}),
      ...(this.staffNumber !== undefined
        ? { staffNumber: this.staffNumber }
        : {}),
    };
  }
}

function parseMemberKind(
  value: string,
): MemberKindMutationCommand['memberKind'] {
  switch (value) {
    case MEMBER_KINDS.STUDENT:
    case MEMBER_KINDS.STAFF:
      return value;
    default:
      throw validationError('지원하지 않는 회원 유형입니다.');
  }
}

function parseExpectedStaffAccess(value: boolean): boolean {
  if (typeof value !== 'boolean') {
    throw validationError('기대하는 교직원 접근 상태가 올바르지 않습니다.');
  }
  return value;
}

function validationError(message: string): DomainException {
  return new DomainException({
    code: SystemErrorCode.VALIDATION_FAILED,
    status: 400,
    message,
  });
}

function transformStaffNumber({ value }: { readonly value: unknown }): unknown {
  return typeof value === 'string' ? normalizeStaffNumber(value) : value;
}

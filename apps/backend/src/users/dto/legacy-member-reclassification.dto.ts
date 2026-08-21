import { Transform } from 'class-transformer';
import { AffiliationKind, MemberKind } from '@prisma/client';
import { IsOptional, IsString, Matches } from 'class-validator';
import { DomainException } from '../../common/error-code';
import { SystemErrorCode } from '../../common/system-error-code.enum';
import { isValidDepartment, isValidUserName } from '../domain/user-profile';
import type { LegacyMemberReclassificationInput } from '../legacy-member-reclassification.service';
import {
  IsProfileText,
  transformProfileText,
  trimString,
} from './profile-text-transform';

export class LegacyMemberReclassificationRequestDto {
  @IsString()
  declare readonly memberKind: string;

  @Transform(transformProfileText)
  @IsString()
  @IsProfileText('isValidUserName', isValidUserName)
  declare readonly name: string;

  @IsString()
  declare readonly affiliationKind: string;

  @Transform(transformProfileText)
  @IsString()
  @IsProfileText('isValidAffiliationName', isValidDepartment)
  declare readonly affiliationName: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @Matches(/^\d{6}$/, { message: '학번은 숫자 6자리로 입력해 주세요.' })
  declare readonly studentId?: string;

  toInput(): LegacyMemberReclassificationInput {
    return {
      memberKind: parseMemberKind(this.memberKind),
      name: this.name,
      affiliationKind: parseAffiliationKind(this.affiliationKind),
      affiliationName: this.affiliationName,
      ...(this.studentId === undefined ? {} : { studentId: this.studentId }),
    };
  }
}

function parseMemberKind(value: string): MemberKind {
  switch (value) {
    case MemberKind.STUDENT:
      return MemberKind.STUDENT;
    case MemberKind.STAFF:
      return MemberKind.STAFF;
    default:
      throw invalidSelection();
  }
}

function parseAffiliationKind(value: string): AffiliationKind {
  switch (value) {
    case AffiliationKind.DEPARTMENT:
      return AffiliationKind.DEPARTMENT;
    case AffiliationKind.PROGRAM_OFFICE:
      return AffiliationKind.PROGRAM_OFFICE;
    default:
      throw invalidSelection();
  }
}

function invalidSelection(): DomainException {
  return new DomainException({
    code: SystemErrorCode.VALIDATION_FAILED,
    status: 400,
    message: '지원하지 않는 회원 유형 또는 소속 유형입니다.',
  });
}

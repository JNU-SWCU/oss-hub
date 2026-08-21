import { Transform } from 'class-transformer';
import { AffiliationKind } from '@prisma/client';
import { IsOptional, IsString, Matches, ValidateIf } from 'class-validator';
import { DomainException } from '../../common/error-code';
import { SystemErrorCode } from '../../common/system-error-code.enum';
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

/**
 * 본인 프로필 쓰기 DTO — 이름·학과는 항상 필수, 학번은 있을 때만 형식을 본다.
 *
 * POST(가입 마치기)와 PATCH(설정 갱신)가 같은 본문을 쓴다. 스크립트가 이름만
 * 보내 학과를 null로 남기는 구멍을 여기서 막는다. 학번 필수 여부는 역할을 아는
 * 서비스가 판정한다 — DTO는 역할을 모른다.
 */
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
      ...(typeof this.affiliationKind === 'string'
        ? { affiliationKind: parseAffiliationKind(this.affiliationKind) }
        : {}),
      ...(typeof this.affiliationName === 'string'
        ? { affiliationName: this.affiliationName }
        : {}),
    };
  }
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

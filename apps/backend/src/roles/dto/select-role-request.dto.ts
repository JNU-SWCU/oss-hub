import { MemberKind } from '@prisma/client';
import { IsString } from 'class-validator';
import { DomainException } from '../../common/error-code';
import type { SelectableMemberKind } from '../domain/member-onboarding';
import { ROLES_ERROR_CODES, RolesErrorCode } from '../roles-error-code.enum';

/**
 * 가입 화면이 보내는 회원 유형 선택.
 *
 * 필드 이름이 `selectedRole`인 것은 **전송 계약**이라 그대로 둔다 — 값 집합
 * (`STUDENT | STAFF`)은 `MemberKind`와 정확히 같고, 이름만 바꾸면 롤백 대상
 * 프런트 이미지가 이 요청을 만들지 못한다. 서버 안쪽은 `MemberKind`로만 다룬다.
 */
export class SelectStaffAccessRequestDto {
  @IsString()
  declare readonly selectedRole: string;

  toMemberKind(): SelectableMemberKind {
    switch (this.selectedRole) {
      case MemberKind.STUDENT:
        return MemberKind.STUDENT;
      case MemberKind.STAFF:
        return MemberKind.STAFF;
      default:
        throw new DomainException(
          ROLES_ERROR_CODES[RolesErrorCode.INVALID_ROLE_SELECTION],
        );
    }
  }
}

import { AccountStatus, MemberKind } from '@prisma/client';
import type { AuthUser } from '../domain/auth-user';
import { MeResponseDto } from './me-response.dto';

/**
 * bridge 전용 `role` 표시 투영.
 *
 * 이 칸이 있는 이유는 하나뿐이다 — 직전 프런트엔드 번들(v0.6.110)의
 * `use-session-role.ts`가 `user.role === null`로 **온보딩 분기 전체를 가른다**.
 * 이 값이 없으면 이미 가입을 마친 사용자까지 역할 선택 화면으로 되돌아간다.
 *
 * 그래서 다음 두 가지를 함께 못박는다.
 *
 *   1. 값이 **canonical 세 사실에서만** 나온다. legacy `User.role` 컬럼은 롤백을 위해
 *      스키마에 남아 있을 뿐 사실의 근거가 아니다.
 *   2. 이 값은 **표시용**이다. 인가는 언제나 `hasStaffAccess`·`hasAdminAccess`를
 *      각각 보며, 한 단어로 접는 순간 학생 관리자가 "ADMIN"으로만 보이고 학생이라는
 *      사실이 사라진다.
 */
function authUser(overrides: Partial<AuthUser>): AuthUser {
  return {
    id: 'synthetic-id',
    githubId: 424_242n,
    nickname: 'synthetic-login',
    name: null,
    avatarUrl: null,
    accountStatus: AccountStatus.ACTIVE,
    memberKind: null,
    hasStaffAccess: false,
    hasAdminAccess: false,
    isProfileComplete: false,
    ...overrides,
  };
}

describe('MeResponseDto bridge role projection', () => {
  it.each<[string, Partial<AuthUser>, 'STUDENT' | 'STAFF' | 'ADMIN' | null]>([
    ['아무 사실도 없는 계정', {}, null],
    ['학생 회원', { memberKind: MemberKind.STUDENT }, 'STUDENT'],
    ['교직원 접근', { hasStaffAccess: true }, 'STAFF'],
    ['관리자 접근', { hasAdminAccess: true }, 'ADMIN'],
  ])(
    '%s의 표시 역할은 canonical 사실에서만 나온다',
    (_label, facts, expected) => {
      // When
      const dto = MeResponseDto.from(authUser(facts));

      // Then
      expect(dto.role).toBe(expected);
    },
  );

  it('학생 관리자는 ADMIN으로 표시되지만 회원 유형은 그대로 남는다', () => {
    // Given — 권한과 정체성은 독립이다. 한 단어로 접으면 학생이라는 사실이 사라지므로
    // 표시 값과 별개로 `memberKind`가 응답에 그대로 실려야 한다.
    const dto = MeResponseDto.from(
      authUser({ memberKind: MemberKind.STUDENT, hasAdminAccess: true }),
    );

    // Then
    expect(dto.role).toBe('ADMIN');
    expect(dto.memberKind).toBe(MemberKind.STUDENT);
    // 인가의 근거는 접힌 한 단어가 아니라 두 boolean이다.
    expect(dto.hasAdminAccess).toBe(true);
    expect(dto.hasStaffAccess).toBe(false);
  });

  it('교직원 접근과 관리자 접근은 서로를 함의하지 않는다', () => {
    // Given — 관리자가 곧 교직원은 아니다.
    const admin = MeResponseDto.from(authUser({ hasAdminAccess: true }));

    // Then
    expect(admin.hasStaffAccess).toBe(false);
    expect(admin.memberKind).toBeNull();
  });
});

import { EMPTY_MEMBER_ACCESS } from '../_shell/member-access';
import { describe, expect, it } from 'vitest';
import { ROLE_HOME_LABEL } from '../_shell/role-home-link';
import { roleHomePath } from '../_shell/role';
import { ONBOARDING_ENTRY_PATH, signupEntryDecision } from './signup-entry';

describe('signupEntryDecision', () => {
  it('비로그인 방문자에게는 가입·로그인 안내를 보여 준다', () => {
    expect(signupEntryDecision('anonymous', EMPTY_MEMBER_ACCESS)).toEqual({
      kind: 'invite',
    });
  });

  it('세션을 아직 모르는 동안에는 안내도 이동도 하지 않는다', () => {
    expect(signupEntryDecision('loading', EMPTY_MEMBER_ACCESS)).toEqual({
      kind: 'checking',
    });
  });

  it('온보딩 중이던 사용자는 멈춘 자리를 이어서 진행하게 한다', () => {
    const decision = signupEntryDecision('unassigned', EMPTY_MEMBER_ACCESS);

    expect(decision).toEqual({
      kind: 'resume',
      href: ONBOARDING_ENTRY_PATH,
      label: '이어서 진행하기',
    });
  });

  it('온보딩 입구는 필수 동의 화면이다', () => {
    expect(ONBOARDING_ENTRY_PATH).toBe('/consent');
  });

  it.each(['STUDENT', 'STAFF', 'ADMIN'] as const)(
    '역할이 확정된 %s는 가입 권유 대신 역할 홈으로 되돌린다',
    (role) => {
      const decision = signupEntryDecision('assigned', accessFor(role));

      expect(decision).toEqual({
        kind: 'resume',
        href: roleHomePath(),
        label: ROLE_HOME_LABEL[role],
      });
    },
  );

  it('세션 조회에 실패해도 안내는 계속 보여 준다', () => {
    expect(signupEntryDecision('error', EMPTY_MEMBER_ACCESS)).toEqual({
      kind: 'invite',
    });
  });
});

function accessFor(role: 'STUDENT' | 'STAFF' | 'ADMIN') {
  return {
    memberKind: role === 'ADMIN' ? null : role,
    hasStaffAccess: role === 'STAFF',
    hasAdminAccess: role === 'ADMIN',
  } as const;
}

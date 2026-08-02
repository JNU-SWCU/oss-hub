import { describe, expect, it } from 'vitest';
import { ROLE_HOME_LABEL } from '../_shell/role-home-link';
import { roleHomePath } from '../_shell/role';
import { ONBOARDING_ENTRY_PATH, signupEntryDecision } from './signup-entry';

describe('signupEntryDecision', () => {
  it('비로그인 방문자에게는 가입·로그인 안내를 보여 준다', () => {
    expect(signupEntryDecision('anonymous', null)).toEqual({ kind: 'invite' });
  });

  it('세션을 아직 모르는 동안에는 안내도 이동도 하지 않는다', () => {
    expect(signupEntryDecision('loading', null)).toEqual({ kind: 'checking' });
  });

  // 온보딩을 끝내지 못한 사용자가 가입을 마칠 길은 이 화면뿐이다 — 랜딩에서는
  // 아무도 되돌리지 않기로 했으므로(#144 → #147), 여기서 끊기면 길이 사라진다.
  it('온보딩 중이던 사용자는 멈춘 자리를 이어서 진행하게 한다', () => {
    const decision = signupEntryDecision('unassigned', null);

    expect(decision).toEqual({
      kind: 'resume',
      href: ONBOARDING_ENTRY_PATH,
      label: '이어서 진행하기',
    });
  });

  // 온보딩 입구는 backend가 로그인 직후 보내는 곳과 같아야 한다. 갈라지면 로그인으로
  // 재개할 때와 이 화면으로 재개할 때 도착지가 달라진다.
  it('온보딩 입구는 필수 동의 화면이다', () => {
    expect(ONBOARDING_ENTRY_PATH).toBe('/consent');
  });

  it.each(['STUDENT', 'STAFF', 'ADMIN'] as const)(
    '역할이 확정된 %s는 가입 권유 대신 역할 홈으로 되돌린다',
    (role) => {
      const decision = signupEntryDecision('assigned', role);

      expect(decision).toEqual({
        kind: 'resume',
        href: roleHomePath(role),
        label: ROLE_HOME_LABEL[role],
      });
    },
  );

  // 세션 조회가 실패했다고 오류 화면을 띄우면, GitHub 계정이 없는 방문자가 다시
  // 갈 곳이 없어진다 — 이 화면이 막으려던 구멍을 이 화면이 다시 내는 셈이다.
  it('세션 조회에 실패해도 안내는 계속 보여 준다', () => {
    expect(signupEntryDecision('error', null)).toEqual({ kind: 'invite' });
  });
});

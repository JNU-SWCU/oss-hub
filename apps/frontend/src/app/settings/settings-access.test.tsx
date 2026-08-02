import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  roleGateRedirectPath,
  shouldDelayRedirectForNotice,
} from '../_shell/role-gate';
import type { SessionRoleState } from '../_shell/use-session-role';
import { SETTINGS_ALLOWED_ROLES } from './settings-access';
import {
  SETTINGS_ONBOARDING_NOTICE_BODY,
  SETTINGS_ONBOARDING_NOTICE_HEADING,
  SettingsOnboardingNotice,
} from './settings-onboarding-notice';

// 설정 화면이 쓰는 판단은 `RoleGate`가 쓰는 것과 같은 함수다. 허용 역할 목록은
// 이동 여부에 관여하지 않으므로(권한 불일치는 안내 화면이 맡는다) 넘기지 않는다.
function settingsRedirect(state: SessionRoleState): string | null {
  return roleGateRedirectPath(state);
}

describe('설정 화면 접근 규칙', () => {
  // 가입을 끝내지 않은 사용자가 프로필·알림을 먼저 바꾸면 온보딩의 프로필 입력이
  // 그 값을 다시 덮어쓴다. 대시보드와 같은 규칙으로 온보딩을 먼저 마치게 한다.
  it('역할 요청 이력이 없는 미배정 사용자는 역할 선택으로 보낸다', () => {
    expect(
      settingsRedirect({
        status: 'unassigned',
        role: null,
        roleRequestStatus: null,
        isProfileComplete: true,
      }),
    ).toBe('/onboarding/role');
  });

  // 승인 대기 중인 사용자도 역할이 없으므로 설정을 열 수 없다. 다만 역할 선택으로
  // 되돌리면 이미 낸 요청을 또 내게 되므로 대기 화면으로 보낸다 — 판단은
  // onboardingPathFor가 이미 하고 있고, 설정은 그 결과를 그대로 따른다.
  it.each(['PENDING', 'REJECTED', 'APPROVED'] as const)(
    '%s 요청 이력이 있는 미배정 사용자는 요청 상태 화면으로 보낸다',
    (roleRequestStatus) => {
      expect(
        settingsRedirect({
          status: 'unassigned',
          role: null,
          roleRequestStatus,
          isProfileComplete: true,
        }),
      ).toBe('/onboarding/pending');
    },
  );

  it('회수된 요청은 역할을 다시 고르게 한다', () => {
    expect(
      settingsRedirect({
        status: 'unassigned',
        role: null,
        roleRequestStatus: 'REVOKED',
        isProfileComplete: true,
      }),
    ).toBe('/onboarding/role');
  });

  it.each(['STUDENT', 'STAFF', 'ADMIN'] as const)(
    '역할이 배정된 %s는 설정을 그대로 연다',
    (role) => {
      const state: SessionRoleState = {
        status: 'assigned',
        role,
        roleRequestStatus: null,
        isProfileComplete: true,
      };

      expect(settingsRedirect(state)).toBeNull();
      expect(SETTINGS_ALLOWED_ROLES).toContain(role);
    },
  );

  it('비로그인 사용자는 기존대로 랜딩으로 보낸다', () => {
    expect(
      settingsRedirect({
        status: 'anonymous',
        role: null,
        roleRequestStatus: null,
        isProfileComplete: true,
      }),
    ).toBe('/');
  });

  // 회귀 방지: 조회 실패를 미배정으로 오인해 온보딩으로 보내면, 이미 가입을 마친
  // 사용자에게 "가입을 끝내라"는 화면이 뜬다.
  it('세션 조회 실패는 어디로도 보내지 않는다', () => {
    expect(
      settingsRedirect({
        status: 'error',
        role: null,
        roleRequestStatus: null,
        isProfileComplete: true,
      }),
    ).toBeNull();
  });

  it('조회 중에는 아직 판단하지 않는다', () => {
    expect(
      settingsRedirect({
        status: 'loading',
        role: null,
        roleRequestStatus: null,
        isProfileComplete: true,
      }),
    ).toBeNull();
  });

  it('미배정 사용자에게만 안내를 먼저 보여주고 이동한다', () => {
    expect(shouldDelayRedirectForNotice('unassigned', true)).toBe(true);
    expect(shouldDelayRedirectForNotice('anonymous', true)).toBe(false);
    expect(shouldDelayRedirectForNotice('error', true)).toBe(false);
  });
});

describe('SettingsOnboardingNotice', () => {
  it('무엇을 해야 하는지 말한다', () => {
    const html = renderToStaticMarkup(<SettingsOnboardingNotice />);

    expect(html).toContain(SETTINGS_ONBOARDING_NOTICE_HEADING);
    expect(html).toContain(SETTINGS_ONBOARDING_NOTICE_BODY);
    expect(SETTINGS_ONBOARDING_NOTICE_HEADING).toContain('가입');
  });

  // "권한이 없습니다"는 사용자가 다음에 무엇을 할지 알려주지 않는다.
  it('막연한 권한 문구로 끝내지 않는다', () => {
    const html = renderToStaticMarkup(<SettingsOnboardingNotice />);

    expect(html).not.toContain('권한이 없');
  });

  it('화면이 바뀌는 것을 보조기술에도 알린다', () => {
    const html = renderToStaticMarkup(<SettingsOnboardingNotice />);

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });
});

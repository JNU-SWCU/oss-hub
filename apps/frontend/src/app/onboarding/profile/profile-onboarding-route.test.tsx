import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { SessionRoleState } from '../../_shell/use-session-role';

const mocks = vi.hoisted(() => ({
  useSessionRole: vi.fn(),
  useRouter: vi.fn(() => ({ replace: vi.fn(), push: vi.fn() })),
}));

vi.mock('../../_shell/use-session-role', () => ({
  useSessionRole: mocks.useSessionRole,
}));
vi.mock('next/navigation', () => ({ useRouter: mocks.useRouter }));

import {
  ProfileOnboardingRoute,
  profileOnboardingView,
} from './profile-onboarding-route';

/** 프로필 화면이 실제로 마운트됐을 때만 나오는 표시(`ProfileSkeleton`). */
const PROFILE_SCREEN_MARK = '프로필을 불러오는 중';
/** 학생 기준 폼에서만 나오는 필수 항목. */
const STUDENT_ONLY_FIELD = '학번';

function state(overrides: Partial<SessionRoleState> = {}): SessionRoleState {
  return {
    status: 'loading',
    role: null,
    roleRequestStatus: null,
    isProfileComplete: false,
    ...overrides,
  };
}

function render(overrides: Partial<SessionRoleState> = {}) {
  mocks.useSessionRole.mockReturnValue({
    ...state(overrides),
    retry: () => {},
  });
  return renderToStaticMarkup(<ProfileOnboardingRoute />);
}

describe('profileOnboardingView', () => {
  // 회귀 방지(PR #492 리뷰): 바깥 `AuthGate`가 통과시킨 뒤에도 이 라우트의
  // `useSessionRole`은 새로 마운트되어 역할 요청을 다시 조회한다. 그 창에서 상태를
  // 그대로 화면에 넘기면 role·roleRequestStatus가 모두 null이라 화면이 학생 기준으로
  // 되돌아간다 — 승인을 기다리는 교직원이 학번을 요구받는다.
  it('역할 조회 중에는 폼을 만들지 않는다', () => {
    expect(profileOnboardingView(state({ status: 'loading' }))).toEqual({
      kind: 'pending',
    });
  });

  // 실패를 폼으로 흘리면 "역할을 모름"이 "역할이 없음"으로 접혀 같은 오진을 한다.
  it('역할 조회 실패는 폼 대신 오류로 드러낸다', () => {
    expect(profileOnboardingView(state({ status: 'error' }))).toEqual({
      kind: 'error',
    });
  });

  it('비로그인은 AuthGate의 이동을 기다리며 폼을 만들지 않는다', () => {
    expect(profileOnboardingView(state({ status: 'anonymous' }))).toEqual({
      kind: 'pending',
    });
  });

  it.each(['loading', 'error', 'anonymous'] as const)(
    '%s 상태에서는 어떤 역할 기준도 정하지 않는다',
    (status) => {
      expect(profileOnboardingView(state({ status })).kind).not.toBe('form');
    },
  );

  // 확정된 뒤에는 기존 판단을 그대로 유지한다.
  it('승인 대기 중인 교직원 요청은 교직원 기준으로 묻고 대기 화면으로 보낸다', () => {
    expect(
      profileOnboardingView(
        state({ status: 'unassigned', roleRequestStatus: 'PENDING' }),
      ),
    ).toEqual({
      kind: 'form',
      role: 'STAFF',
      nextPath: '/onboarding/pending',
    });
  });

  it('역할이 배정된 사용자는 자기 역할 홈으로 보낸다', () => {
    expect(
      profileOnboardingView(state({ status: 'assigned', role: 'STUDENT' })),
    ).toEqual({
      kind: 'form',
      role: 'STUDENT',
      nextPath: '/dashboard',
    });
  });

  it('역할 요청 이력이 없는 미배정 사용자는 역할 선택으로 되돌린다', () => {
    expect(profileOnboardingView(state({ status: 'unassigned' }))).toEqual({
      kind: 'form',
      role: null,
      nextPath: '/onboarding/role',
    });
  });
});

describe('ProfileOnboardingRoute', () => {
  it('역할 조회 중에는 프로필 화면을 마운트하지 않는다', () => {
    const html = render({ status: 'loading' });

    expect(html).toContain('확인 중…');
    expect(html).toContain('role="status"');
    expect(html).not.toContain(PROFILE_SCREEN_MARK);
    expect(html).not.toContain(STUDENT_ONLY_FIELD);
  });

  it('역할 조회 실패에는 안내와 재시도를 낸다', () => {
    const html = render({ status: 'error' });

    expect(html).toContain('로그인 정보를 확인하지 못했습니다.');
    expect(html).toContain('다시 시도');
    expect(html).toContain('role="alert"');
    expect(html).not.toContain(PROFILE_SCREEN_MARK);
    expect(html).not.toContain(STUDENT_ONLY_FIELD);
  });

  it('역할이 확정되면 프로필 화면을 연다', () => {
    const html = render({ status: 'assigned', role: 'STUDENT' });

    expect(html).toContain(PROFILE_SCREEN_MARK);
    expect(html).not.toContain('확인 중…');
  });
});

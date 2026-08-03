import type { DependencyList, EffectCallback } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionRoleState } from '../../_shell/use-session-role';

const mocks = vi.hoisted(() => ({
  useSessionRole: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
  /**
   * 서버 렌더에서 React의 `useEffect`는 실행되지 않는다(이 패키지의 vitest 환경은
   * `node`다). 이동을 실제로 일으키는지 보려면 그 한 번만 효과를 직접 돌려야 한다.
   */
  runEffectsSynchronously: { value: false },
}));

vi.mock('../../_shell/use-session-role', () => ({
  useSessionRole: mocks.useSessionRole,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace, push: mocks.push }),
}));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useEffect: (effect: EffectCallback, deps?: DependencyList) => {
      if (mocks.runEffectsSynchronously.value) {
        effect();
        return;
      }
      actual.useEffect(effect, deps);
    },
  };
});

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

  it('승인된 역할 요청도 폼을 연다', () => {
    expect(
      profileOnboardingView(
        state({ status: 'unassigned', roleRequestStatus: 'APPROVED' }),
      ),
    ).toEqual({
      kind: 'form',
      role: 'STAFF',
      nextPath: '/onboarding/pending',
    });
  });

  // 역할을 고르지 않은 사람은 가입을 마치지 않은 사람이다(#493). 폼을 열어 주면 역할을
  // 모르는 채 학생 기준으로 그려져, 학번이 필요 없는 사람이 가짜 학번을 지어내야 넘어가고
  // 백엔드가 그 값을 잠근다(`USR_003`). 비로그인과 같이 랜딩으로 되돌린다.
  it('역할 요청 이력이 없는 미배정 사용자는 랜딩으로 되돌린다', () => {
    expect(profileOnboardingView(state({ status: 'unassigned' }))).toEqual({
      kind: 'redirect',
      path: '/',
    });
  });

  // 회수된 역할은 `onboardingPathFor`가 요청 없음과 같은 자리(역할 선택)로 분류한다.
  // 다시 고르기 전에는 무엇을 물어야 할지 알 수 없으므로 같이 되돌린다.
  it('역할이 회수된 사용자도 랜딩으로 되돌린다', () => {
    expect(
      profileOnboardingView(
        state({ status: 'unassigned', roleRequestStatus: 'REVOKED' }),
      ),
    ).toEqual({ kind: 'redirect', path: '/' });
  });

  it.each(['PENDING', 'APPROVED'] as const)(
    '역할을 고른 %s 상태의 교직원은 되돌리지 않는다',
    (roleRequestStatus) => {
      expect(
        profileOnboardingView(
          state({ status: 'unassigned', roleRequestStatus }),
        ).kind,
      ).toBe('form');
    },
  );

  it.each(['STUDENT', 'STAFF', 'ADMIN'] as const)(
    '역할이 배정된 %s 사용자는 되돌리지 않는다',
    (role) => {
      expect(
        profileOnboardingView(state({ status: 'assigned', role })).kind,
      ).toBe('form');
    },
  );

  // 반려는 이 PR의 판단 대상이 아니다 — 역할을 고르긴 골랐고, 되돌릴 자리는
  // `onboardingPathFor`가 승인 대기(반려 사유를 읽는 자리)로 정해 두었다.
  it('반려된 사용자의 처리는 그대로 둔다', () => {
    expect(
      profileOnboardingView(
        state({ status: 'unassigned', roleRequestStatus: 'REJECTED' }),
      ),
    ).toEqual({
      kind: 'form',
      role: null,
      nextPath: '/onboarding/pending',
    });
  });
});

describe('ProfileOnboardingRoute', () => {
  beforeEach(() => {
    mocks.replace.mockClear();
    mocks.runEffectsSynchronously.value = false;
  });

  afterEach(() => {
    mocks.runEffectsSynchronously.value = false;
  });

  it('역할을 고르지 않은 사용자에게는 폼 대신 랜딩으로 되돌린다', () => {
    mocks.runEffectsSynchronously.value = true;

    const html = render({ status: 'unassigned' });

    expect(mocks.replace).toHaveBeenCalledWith('/');
    expect(html).toContain('확인 중…');
    expect(html).not.toContain(PROFILE_SCREEN_MARK);
    expect(html).not.toContain(STUDENT_ONLY_FIELD);
  });

  it('역할이 회수된 사용자도 랜딩으로 되돌린다', () => {
    mocks.runEffectsSynchronously.value = true;

    const html = render({ status: 'unassigned', roleRequestStatus: 'REVOKED' });

    expect(mocks.replace).toHaveBeenCalledWith('/');
    expect(html).not.toContain(PROFILE_SCREEN_MARK);
  });

  // 승인 전 교직원은 세션 `role`이 비어 있을 뿐 역할을 고른 사람이다. 여기서 되돌리면
  // 교직원 가입이 통째로 막힌다. 되돌리는 화면은 `확인 중…`이므로 프로필 화면이 떴다는
  // 것 자체가 통과의 증거다(프로필 화면은 효과를 돌리지 않아도 마운트된다).
  it('승인 대기 중인 교직원은 되돌리지 않고 프로필 화면을 연다', () => {
    const html = render({ status: 'unassigned', roleRequestStatus: 'PENDING' });

    expect(html).toContain(PROFILE_SCREEN_MARK);
    expect(html).not.toContain('확인 중…');
  });

  it('역할이 배정된 사용자는 되돌리지 않는다', () => {
    const html = render({ status: 'assigned', role: 'STUDENT' });

    expect(html).toContain(PROFILE_SCREEN_MARK);
    expect(html).not.toContain('확인 중…');
  });

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

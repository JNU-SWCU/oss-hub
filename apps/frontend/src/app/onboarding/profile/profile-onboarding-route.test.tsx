import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { SessionRoleState } from '../../_shell/use-session-role';

const mocks = vi.hoisted(() => ({ useSessionRole: vi.fn() }));

vi.mock('../../_shell/use-session-role', () => ({
  useSessionRole: mocks.useSessionRole,
}));

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));

import {
  ProfileOnboardingRoute,
  profileOnboardingView,
} from './profile-onboarding-route';

const PROFILE_SCREEN_MARK = '프로필을 불러오는 중';

const STUDENT_ONLY_FIELD = '학번';

const LANDING_REDIRECT_DIGEST = 'NEXT_REDIRECT;replace;/;307;';
const ROLE_REDIRECT_DIGEST = 'NEXT_REDIRECT;replace;/onboarding/role;307;';

function state(overrides: Partial<SessionRoleState> = {}): SessionRoleState {
  return {
    status: 'loading',
    memberKind: null,
    hasStaffAccess: false,
    hasAdminAccess: false,
    staffAccessRequestStatus: null,
    staffAccessRequestRejectionReason: null,
    selectedRole: null,
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

function renderRedirectDigest(overrides: Partial<SessionRoleState>) {
  try {
    render(overrides);
  } catch (error) {
    return (error as { digest?: string }).digest;
  }
  return '이동 없이 렌더가 끝났다';
}

describe('profileOnboardingView', () => {
  it('역할 조회 중에는 폼을 만들지 않는다', () => {
    expect(profileOnboardingView(state({ status: 'loading' }))).toEqual({
      kind: 'pending',
    });
  });

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

  it('승인 대기 중인 교직원 요청은 교직원 기준으로 묻고 대기 화면으로 보낸다', () => {
    expect(
      profileOnboardingView(
        state({ status: 'unassigned', staffAccessRequestStatus: 'PENDING' }),
      ),
    ).toEqual({
      kind: 'form',
      memberKind: 'STAFF',
      nextPath: '/onboarding/pending',

      canChangeRole: false,
    });
  });

  it('회원 유형이 배정된 사용자는 자기 홈으로 보낸다', () => {
    expect(
      profileOnboardingView(
        state({ status: 'assigned', memberKind: 'STUDENT' }),
      ),
    ).toEqual({
      kind: 'form',
      memberKind: 'STUDENT',
      nextPath: '/dashboard',
      canChangeRole: false,
    });
  });

  it('승인된 역할 요청도 폼을 연다', () => {
    expect(
      profileOnboardingView(
        state({ status: 'unassigned', staffAccessRequestStatus: 'APPROVED' }),
      ),
    ).toEqual({
      kind: 'form',
      memberKind: 'STAFF',
      nextPath: '/onboarding/pending',
      canChangeRole: false,
    });
  });

  it('고른 흔적이 하나도 없는 미배정 사용자는 랜딩으로 되돌린다', () => {
    expect(profileOnboardingView(state({ status: 'unassigned' }))).toEqual({
      kind: 'redirect',
      path: '/',
    });
  });

  it.each(['STUDENT', 'STAFF'] as const)(
    '%s을 고른 사람은 요청이 없어도 폼을 연다',
    (selectedRole) => {
      expect(
        profileOnboardingView(state({ status: 'unassigned', selectedRole })),
      ).toEqual({
        kind: 'form',
        memberKind: selectedRole,
        nextPath:
          selectedRole === 'STUDENT' ? '/dashboard' : '/onboarding/pending',

        canChangeRole: true,
      });
    },
  );

  it('승인 대기 교직원은 고른 기록이 비어 있어도 교직원 기준이다', () => {
    const view = profileOnboardingView(
      state({
        status: 'unassigned',
        staffAccessRequestStatus: 'PENDING',
        selectedRole: null,
      }),
    );

    expect(view).toMatchObject({ kind: 'form', memberKind: 'STAFF' });
  });

  it.each(['REVOKED', 'REJECTED'] as const)(
    '살아 있는 신청이 없는 %s 사용자는 역할 선택으로 되돌린다',
    (staffAccessRequestStatus) => {
      expect(
        profileOnboardingView(
          state({ status: 'unassigned', staffAccessRequestStatus }),
        ),
      ).toEqual({ kind: 'redirect', path: '/onboarding/role' });
    },
  );

  it('회수된 사용자에게는 학생 기준 폼 대신 역할 선택을 준다', () => {
    expect(
      profileOnboardingView(
        state({ status: 'unassigned', staffAccessRequestStatus: 'REVOKED' }),
      ),
    ).toEqual({ kind: 'redirect', path: '/onboarding/role' });
  });

  it.each(['PENDING', 'APPROVED'] as const)(
    '역할을 고른 %s 상태의 교직원은 되돌리지 않는다',
    (staffAccessRequestStatus) => {
      expect(
        profileOnboardingView(
          state({ status: 'unassigned', staffAccessRequestStatus }),
        ).kind,
      ).toBe('form');
    },
  );

  it.each(['STUDENT', 'STAFF'] as const)(
    '회원 유형이 배정된 %s 사용자는 되돌리지 않는다',
    (role) => {
      expect(
        profileOnboardingView(state({ status: 'assigned', memberKind: role }))
          .kind,
      ).toBe('form');
    },
  );

  it('반려된 사용자도 역할 선택으로 되돌린다', () => {
    expect(
      profileOnboardingView(
        state({ status: 'unassigned', staffAccessRequestStatus: 'REJECTED' }),
      ),
    ).toEqual({ kind: 'redirect', path: '/onboarding/role' });
  });
});

describe('ProfileOnboardingRoute', () => {
  it('역할을 고르지 않은 사용자는 폼을 그리기 전에 랜딩으로 이동한다', () => {
    expect(renderRedirectDigest({ status: 'unassigned' })).toBe(
      LANDING_REDIRECT_DIGEST,
    );
  });

  it('승인 대기 중인 교직원은 되돌리지 않고 프로필 화면을 연다', () => {
    const html = render({
      status: 'unassigned',
      staffAccessRequestStatus: 'PENDING',
    });

    expect(html).toContain(PROFILE_SCREEN_MARK);
    expect(html).not.toContain('확인 중…');
  });

  it.each(['REVOKED', 'REJECTED'] as const)(
    '살아 있는 신청이 없는 %s 사용자는 폼을 그리기 전에 역할 선택으로 이동한다',
    (staffAccessRequestStatus) => {
      expect(
        renderRedirectDigest({
          status: 'unassigned',
          staffAccessRequestStatus,
        }),
      ).toBe(ROLE_REDIRECT_DIGEST);
    },
  );

  it('역할이 배정된 사용자는 되돌리지 않는다', () => {
    const html = render({
      status: 'assigned',
      memberKind: 'STUDENT',
    });

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
    const html = render({
      status: 'assigned',
      memberKind: 'STUDENT',
    });

    expect(html).toContain(PROFILE_SCREEN_MARK);
    expect(html).not.toContain('확인 중…');
  });
});

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { SessionRoleState } from '../../_shell/use-session-role';

const mocks = vi.hoisted(() => ({ useSessionRole: vi.fn() }));

vi.mock('../../_shell/use-session-role', () => ({
  useSessionRole: mocks.useSessionRole,
}));
/**
 * `redirect`는 진짜를 그대로 쓴다 — 이동을 흉내 내면 이 라우트가 실제로 이동하는지는
 * 확인하지 못한다. `useRouter`만 대신 세워 준다. 자식 `ProfileOnboardingScreen`이
 * 저장 후 이동에 쓰는데, 서버 렌더에는 app router가 없어 그대로 두면 던진다.
 */
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));

import {
  ProfileOnboardingRoute,
  profileOnboardingView,
} from './profile-onboarding-route';

/** 프로필 화면이 실제로 마운트됐을 때만 나오는 표시(`ProfileSkeleton`). */
const PROFILE_SCREEN_MARK = '프로필을 불러오는 중';
/** 학생 기준 폼에서만 나오는 필수 항목. */
const STUDENT_ONLY_FIELD = '학번';
/**
 * `redirect('/')`가 렌더를 중단시키며 남기는 표식. `next/navigation`을 그대로 쓰므로
 * 흉내 낸 값이 아니라 Next가 실제로 만드는 digest다 — `replace`라 뒤로 가기에 이
 * 화면이 남지 않는다(`AuthGate`의 `router.replace('/')`와 같은 성질).
 */
const LANDING_REDIRECT_DIGEST = 'NEXT_REDIRECT;replace;/;307;';

function state(overrides: Partial<SessionRoleState> = {}): SessionRoleState {
  return {
    status: 'loading',
    role: null,
    roleRequestStatus: null,
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

/** 렌더가 이동으로 끝났을 때 Next가 던지는 오류의 digest. 끝나지 않았으면 실패시킨다. */
function renderRedirectDigest(overrides: Partial<SessionRoleState>) {
  try {
    render(overrides);
  } catch (error) {
    return (error as { digest?: string }).digest;
  }
  return '이동 없이 렌더가 끝났다';
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
      // 이미 확정된 사람이다. 되돌아가면 백엔드가 409로 막으므로 길을 열지 않는다.
      canChangeRole: false,
    });
  });

  it('역할이 배정된 사용자는 자기 역할 홈으로 보낸다', () => {
    expect(
      profileOnboardingView(state({ status: 'assigned', role: 'STUDENT' })),
    ).toEqual({
      kind: 'form',
      role: 'STUDENT',
      nextPath: '/dashboard',
      canChangeRole: false,
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
      canChangeRole: false,
    });
  });

  // 역할을 고르지 않은 사람은 가입을 마치지 않은 사람이다(#493). 폼을 열어 주면 역할을
  // 모르는 채 학생 기준으로 그려져, 학번이 필요 없는 사람이 가짜 학번을 지어내야 넘어가고
  // 백엔드가 그 값을 잠근다(`USR_003`). 비로그인과 같이 랜딩으로 되돌린다.
  it('고른 흔적이 하나도 없는 미배정 사용자는 랜딩으로 되돌린다', () => {
    expect(profileOnboardingView(state({ status: 'unassigned' }))).toEqual({
      kind: 'redirect',
      path: '/',
    });
  });

  /**
   * #569 회귀 검사 — **고른 역할만 있는 사람은 되돌리지 않는다.**
   *
   * 확정을 `가입 마치기`로 미룬 뒤, 프로필을 처음 채우는 사람에게는 역할도 요청도
   * 없고 고른 기록만 있다. 여기서 요청 유무만 보고 되돌리면 가입 동선이 프로필
   * 단계에서 끊겨 아무도 가입을 마칠 수 없다.
   */
  it.each(['STUDENT', 'STAFF'] as const)(
    '%s을 고른 사람은 요청이 없어도 폼을 연다',
    (selectedRole) => {
      expect(
        profileOnboardingView(state({ status: 'unassigned', selectedRole })),
      ).toEqual({
        kind: 'form',
        role: selectedRole,
        nextPath:
          selectedRole === 'STUDENT' ? '/dashboard' : '/onboarding/pending',
        // 아직 확정 전이라 되돌아갈 수 있다.
        canChangeRole: true,
      });
    },
  );

  /**
   * #569 회귀 검사 ③ — 승인 대기 교직원의 필수 항목은 그대로 '학번 선택'이다.
   *
   * 판정 근거에 고른 역할이 하나 늘었는데(`effectiveProfileRole`) 우선순위가
   * 어긋나면, 승인을 기다리는 교직원이 학생 기준으로 그려져 학번을 요구받는다.
   */
  it('승인 대기 교직원은 고른 기록이 비어 있어도 교직원 기준이다', () => {
    // Given — 마이그레이션 전에 신청한 사용자는 새 칸이 비어 있을 수 있다.
    const view = profileOnboardingView(
      state({
        status: 'unassigned',
        roleRequestStatus: 'PENDING',
        selectedRole: null,
      }),
    );

    // Then
    expect(view).toMatchObject({ kind: 'form', role: 'STAFF' });
  });

  // 되돌리는 범위는 "요청이 아예 없음" 하나다. 회수·반려는 역할을 고르긴 고른
  // 사용자라 `onboardingPathFor`가 정해 둔 기존 경로를 그대로 둔다(PR #525 리뷰).
  it.each(['REVOKED', 'REJECTED'] as const)(
    '역할 요청 이력이 있는 %s 사용자는 되돌리지 않는다',
    (roleRequestStatus) => {
      expect(
        profileOnboardingView(
          state({ status: 'unassigned', roleRequestStatus }),
        ).kind,
      ).not.toBe('redirect');
    },
  );

  it('회수된 사용자의 처리는 그대로 둔다', () => {
    expect(
      profileOnboardingView(
        state({ status: 'unassigned', roleRequestStatus: 'REVOKED' }),
      ),
    ).toEqual({
      kind: 'form',
      role: null,
      nextPath: '/onboarding/role',
      // 요청 이력이 있는 사용자의 되돌아가기는 `onboardingPathFor`가 이미 정해
      // 두었다(회수는 역할 선택, 반려는 승인 대기). 여기에 두 번째 문을 내지 않는다.
      canChangeRole: false,
    });
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
      canChangeRole: false,
    });
  });
});

describe('ProfileOnboardingRoute', () => {
  // 이동을 결정만 하고 실행하지 않으면 폼이 그대로 열린다. 결정과 실행을 함께 본다.
  it('역할을 고르지 않은 사용자는 폼을 그리기 전에 랜딩으로 이동한다', () => {
    expect(renderRedirectDigest({ status: 'unassigned' })).toBe(
      LANDING_REDIRECT_DIGEST,
    );
  });

  // 승인 전 교직원은 세션 `role`이 비어 있을 뿐 역할을 고른 사람이다. 여기서 되돌리면
  // 교직원 가입이 통째로 막힌다.
  it('승인 대기 중인 교직원은 되돌리지 않고 프로필 화면을 연다', () => {
    const html = render({ status: 'unassigned', roleRequestStatus: 'PENDING' });

    expect(html).toContain(PROFILE_SCREEN_MARK);
    expect(html).not.toContain('확인 중…');
  });

  it.each(['REVOKED', 'REJECTED'] as const)(
    '역할 요청 이력이 있는 %s 사용자도 화면을 그대로 연다',
    (roleRequestStatus) => {
      const html = render({ status: 'unassigned', roleRequestStatus });

      expect(html).toContain(PROFILE_SCREEN_MARK);
    },
  );

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

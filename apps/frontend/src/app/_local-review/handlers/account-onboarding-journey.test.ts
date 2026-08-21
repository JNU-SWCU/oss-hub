import { describe, expect, it, vi } from 'vitest';
import type { RoleRequestStatus } from '@/features/roles/types';
import { onboardingPathFor } from '../../_shell/onboarding-route';
import type { AppRole } from '../../_shell/role';
import { profileOnboardingView } from '../../onboarding/profile/profile-onboarding-route';
import { resetLocalReviewFixtureState } from '../fixture-response';
import { canonicalLocalReviewSessionBody } from '../session-contract';
import { call, callWithBody, jsonBody } from './account-handlers-test-support';

/**
 * 검토자가 실제로 걷는 가입 동선을 통째로 잠근다.
 *
 * 화면이 다음 단계를 어디로 정하는지는 `_shell/onboarding-route.ts`의
 * `onboardingPathFor`가 결정한다. 그 함수에 픽스처 응답을 그대로 먹여 동선을
 * 따라가는 이유는, 여기서 같은 판단을 다시 적으면 잠그는 대상이 화면이 아니라
 * 이 테스트 자신이 되기 때문이다.
 */
describe('가입 동선 — 약관 → 교직원 선택 → 프로필 → 승인 대기', () => {
  /** 지금 이 검토자가 있어야 할 온보딩 화면. 게이트가 읽는 두 값에서 파생시킨다. */
  function currentOnboardingPath(): string | null {
    const roleRequest = jsonBody(
      call('unassigned', 'GET', 'role-requests/me'),
    ) as { readonly status: RoleRequestStatus } | null;
    const profile = jsonBody(call('unassigned', 'GET', 'users/me/profile')) as {
      readonly isComplete: boolean;
    };
    return onboardingPathFor(
      roleRequest?.status ?? null,
      profile.isComplete ? 'complete' : 'incomplete',
    );
  }

  /**
   * 프로필 화면이 이 검토자에게 무엇을 할지. 그 화면은 `OnboardingGate`가 아니라
   * `ProfileOnboardingRoute`가 지키므로(#569 이후로는 고른 역할까지 봐야 한다) 판단도
   * 그 함수에게 그대로 물어본다 — 여기서 같은 판단을 다시 적으면 잠그는 대상이 화면이
   * 아니라 이 테스트 자신이 된다.
   */
  function currentProfileView() {
    const roleRequest = jsonBody(
      call('unassigned', 'GET', 'role-requests/me'),
    ) as { readonly status: RoleRequestStatus } | null;
    const selection = jsonBody(
      call('unassigned', 'GET', 'onboarding/role'),
    ) as {
      readonly selectedRole: 'STUDENT' | 'STAFF' | null;
    };
    const session = canonicalLocalReviewSessionBody(
      'auth/session',
      jsonBody(call('unassigned', 'GET', 'auth/session')),
    ) as {
      readonly user: {
        readonly role: AppRole | null;
        readonly memberKind: 'STUDENT' | 'STAFF' | null;
        readonly hasStaffAccess: boolean;
        readonly hasAdminAccess: boolean;
      };
    };
    return profileOnboardingView({
      status: session.user.role ? 'assigned' : 'unassigned',
      role: session.user.role,
      memberKind: session.user.memberKind,
      hasStaffAccess: session.user.hasStaffAccess,
      hasAdminAccess: session.user.hasAdminAccess,
      roleRequestStatus: roleRequest?.status ?? null,
      roleRequestRejectionReason: null,
      selectedRole: selection.selectedRole,
      isProfileComplete: false,
    });
  }

  it('교직원을 고른 검토자가 프로필을 거쳐 승인 대기 화면까지 도착한다', () => {
    // Given: 검토판 링크(`/local-review/unassigned?to=/consent`)를 막 누른 상태.
    resetLocalReviewFixtureState();

    // When / Then 1 — 약관. 아직 동의 전이라 화면이 떠야 하고, 다음은 역할 선택이다.
    expect(
      jsonBody(call('unassigned', 'GET', 'consents/current')),
    ).toMatchObject({ consented: false, nextUrl: '/onboarding/role' });
    expect(jsonBody(call('unassigned', 'POST', 'consents'))).toMatchObject({
      nextUrl: '/onboarding/role',
    });

    // 2 — 교직원 선택. 고른 사실만 남고, 남은 단계인 프로필로 바로 보낸다.
    const selection = jsonBody(
      callWithBody('unassigned', 'POST', 'onboarding/role', {
        selectedRole: 'STAFF',
      }),
    ) as { readonly redirectTo: string };
    expect(selection).toMatchObject({
      selectedRole: 'STAFF',
      redirectTo: '/onboarding/profile',
    });
    // 2-1 — 관리자 대기줄에 미완성 신청이 올라가지 않는다(#569). 프로필을 한 글자도
    //       입력하기 전이라 이름·학과가 비어 있다.
    expect(jsonBody(call('unassigned', 'GET', 'role-requests/me'))).toBeNull();

    // 3 — 왕복이 없어야 한다. 역할 선택이 준 목적지에 도착했을 때 그 화면이 폼을
    //     열어 줘야 제자리를 돌지 않는다. 여기서 고른 역할이 잊히면 그 화면이
    //     랜딩으로 되돌리고, 검토자는 가입을 마칠 방법이 없다.
    //
    //     이 화면의 게이트는 `OnboardingGate`가 아니라 `ProfileOnboardingRoute`다.
    //     아직 확정된 것이 없어 `onboardingPathFor`는 `/onboarding/role`을 가리키는데
    //     (되돌아갈 수 있어야 하므로 그것이 맞다) 그 값은 이 화면을 막지 않는다.
    expect(selection.redirectTo).toBe('/onboarding/profile');
    expect(currentProfileView()).toMatchObject({
      kind: 'form',
      // 교직원이라 학번을 묻지 않는다.
      memberKind: 'STAFF',
      nextPath: '/onboarding/pending',
      // 확정 전이라 역할 선택으로 되돌아갈 수 있다.
      canChangeRole: true,
    });

    // 4 — 프로필 저장. 교직원이라 학번은 묻지 않는다.
    expect(
      jsonBody(
        callWithBody('unassigned', 'POST', 'users/me/profile', {
          name: '합성 교직원 사용자',
          department: '인공지능학부',
        }),
      ),
    ).toMatchObject({ isComplete: true });

    // 5 — 저장 뒤 다시 게이트. 이번엔 승인 대기 화면이 목적지다. 승인 요청은 바로
    //     이 저장에서 생긴다(#569). 세션 역할은 승인 전이라 계속 비어 있어야
    //     온보딩 밖(역할 홈)으로 튕기지 않는다.
    expect(
      jsonBody(call('unassigned', 'GET', 'role-requests/me')),
    ).toMatchObject({ requestedRole: 'STAFF', status: 'PENDING' });
    expect(currentOnboardingPath()).toBe('/onboarding/pending');
    expect(jsonBody(call('unassigned', 'GET', 'auth/session'))).toMatchObject({
      isAuthenticated: true,
      user: { role: null },
    });
  });

  /**
   * 검토가 실제로 깨진 자리. Next 개발 서버는 화면을 처음 열 때 그 라우트를
   * 컴파일하면서 서버 모듈을 새로 평가하고, 모듈 최상단 `let`에 담아 둔 값은 그때
   * 초기값으로 돌아간다. `vi.resetModules()` + 동적 import 가 그 재평가와 같은 일을
   * 한다 — 이 잠금이 없으면 "요청 사이에 남는다"까지만 확인하게 되고, 정작 검토가
   * 깨지는 조건(라우트 첫 컴파일)은 아무도 지키지 않는다.
   */
  it('라우트가 처음 컴파일돼 모듈이 다시 평가돼도 가입 도중 상태가 남는다', async () => {
    // Given: 교직원을 고르고 프로필까지 저장한 상태.
    resetLocalReviewFixtureState();
    callWithBody('unassigned', 'POST', 'onboarding/role', {
      selectedRole: 'STAFF',
    });
    callWithBody('unassigned', 'POST', 'users/me/profile', {
      name: '합성 교직원 사용자',
      department: '인공지능학부',
    });

    // When: `/onboarding/pending`을 처음 여는 순간과 같은 모듈 재평가.
    vi.resetModules();
    const reloaded = await import('../fixture-response');
    function readAfterReload(
      path: string,
    ): ReturnType<typeof reloaded.resolveLocalReviewResponse> {
      return reloaded.resolveLocalReviewResponse({
        fixture: 'unassigned',
        method: 'GET',
        path,
        searchParams: new URLSearchParams(),
      });
    }

    // Then: 역할 요청이 `null`로 바뀌면 대기 화면이 역할 선택으로 되튕겨,
    // 검토자는 방금 고른 교직원이 안 골라진 것으로 본다.
    expect(jsonBody(readAfterReload('role-requests/me'))).toMatchObject({
      requestedRole: 'STAFF',
      status: 'PENDING',
    });
    expect(jsonBody(readAfterReload('users/me/profile'))).toMatchObject({
      isComplete: true,
    });
  });
});

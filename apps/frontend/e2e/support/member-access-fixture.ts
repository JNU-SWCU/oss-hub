import type { Page, Route } from '@playwright/test';

export type SyntheticMemberKind = 'STUDENT' | 'STAFF';

export interface SyntheticAuthority {
  readonly role: 'STUDENT' | 'STAFF' | 'ADMIN' | null;
  readonly memberKind: SyntheticMemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
  readonly isProfileComplete?: boolean;
}

const EMPTY_PROFILE = {
  name: '합성 가입 사용자',
  studentId: null,
  department: null,
  isComplete: false,
} as const;

function sessionBody(authority: SyntheticAuthority) {
  return {
    isAuthenticated: true,
    user: {
      nickname: 'synthetic-member-access',
      name: '합성 권한 사용자',
      email: null,
      avatarUrl: null,
      ...authority,
      isProfileComplete: authority.isProfileComplete ?? true,
    },
  };
}

async function fulfillJson(
  route: Route,
  body: unknown,
  status = 200,
): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

export async function installSyntheticAuthority(
  page: Page,
  authority: SyntheticAuthority,
): Promise<void> {
  await page.route('**/api/v1/**', (route) => {
    const pathname = new URL(route.request().url()).pathname;
    return pathname.endsWith('/auth/session')
      ? fulfillJson(route, sessionBody(authority))
      : fulfillJson(route, {});
  });
}

export async function installOnboardingFixture(
  page: Page,
): Promise<{ readonly selectedKind: () => SyntheticMemberKind | null }> {
  let selectedKind: SyntheticMemberKind | null = null;
  let completed = false;
  let savedProfile:
    | typeof EMPTY_PROFILE
    | {
        readonly name: string;
        readonly studentId: string | null;
        readonly department: string | null;
        readonly isComplete: true;
      } = EMPTY_PROFILE;

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const method = request.method();

    if (pathname.endsWith('/auth/session')) {
      // 가입을 마치면 회원 유형과 프로필은 둘 다 확정된다 — 교직원도 예외가 아니다.
      // 승인을 기다리는 것은 **접근 권한**(`hasStaffAccess`)뿐이라, 프로필을
      // 미완료로 내려보내면 저장을 마친 사용자가 프로필 단계로 되돌아가
      // 무한히 같은 화면을 다시 본다. 실제 백엔드도 저장된 프로필 행으로
      // `isProfileComplete`를 계산한다(`auth.repository.ts`의 `toDomain`).
      const authority: SyntheticAuthority = {
        role: completed && selectedKind === 'STUDENT' ? 'STUDENT' : null,
        memberKind: completed ? selectedKind : null,
        hasStaffAccess: false,
        hasAdminAccess: false,
        isProfileComplete: savedProfile.isComplete,
      };
      await fulfillJson(route, sessionBody(authority));
      return;
    }
    if (pathname.endsWith('/role-requests/me')) {
      await fulfillJson(
        route,
        completed && selectedKind === 'STAFF'
          ? {
              id: 'synthetic-staff-request',
              status: 'PENDING',
              requestedAt: '2026-08-21T00:00:00.000Z',
              decidedAt: null,
              rejectionReason: null,
            }
          : null,
      );
      return;
    }
    if (pathname.endsWith('/onboarding/role')) {
      if (method === 'GET') {
        await fulfillJson(route, { selectedRole: selectedKind });
        return;
      }
      const body = request.postDataJSON() as { selectedRole?: unknown };
      selectedKind = body.selectedRole === 'STAFF' ? 'STAFF' : 'STUDENT';
      await fulfillJson(route, {
        selectedRole: selectedKind,
        redirectTo: '/onboarding/profile',
      });
      return;
    }
    if (pathname.endsWith('/users/me/profile')) {
      if (method === 'GET') {
        await fulfillJson(route, savedProfile);
        return;
      }
      const body = request.postDataJSON() as {
        name?: string;
        studentId?: string;
        affiliationName?: string;
      };
      completed = true;
      savedProfile = {
        name: body.name ?? '합성 가입 사용자',
        studentId: body.studentId ?? null,
        department: body.affiliationName ?? null,
        isComplete: true,
      };
      await fulfillJson(route, savedProfile);
      return;
    }
    await fulfillJson(route, {});
  });

  return { selectedKind: () => selectedKind };
}

export async function installUnassignedFixture(
  page: Page,
  initialRequestStatus: 'NONE' | 'REJECTED' | 'REVOKED',
): Promise<{
  setRequestStatus: (status: 'NONE' | 'REJECTED' | 'REVOKED') => void;
}> {
  let requestStatus = initialRequestStatus;
  // 가입을 마친 사람과 시작도 안 한 사람은 다른 사람이다.
  // - NONE: 아직 아무것도 고르지 않았다 — 회원 유형도 프로필도 없다.
  // - REJECTED·REVOKED: 가입을 마친 교직원이다. 반려·회수는 **접근 권한만**
  //   거두고 회원 유형과 프로필은 그대로 남기므로(정본 계약), 프로필을 미완료로
  //   내려보내면 이미 입력한 이름·학과를 다시 받는 화면으로 되돌아간다.
  await page.route('**/api/v1/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    // `setRequestStatus`로 상태가 바뀌므로 요청마다 다시 계산한다.
    const isSettledMember = requestStatus !== 'NONE';
    if (pathname.endsWith('/auth/session')) {
      await fulfillJson(
        route,
        sessionBody({
          role: null,
          memberKind: isSettledMember ? 'STAFF' : null,
          hasStaffAccess: false,
          hasAdminAccess: false,
          isProfileComplete: isSettledMember,
        }),
      );
      return;
    }
    if (pathname.endsWith('/role-requests/me')) {
      await fulfillJson(
        route,
        requestStatus === 'NONE'
          ? null
          : {
              id: `synthetic-${requestStatus.toLowerCase()}`,
              status: requestStatus,
              requestedAt: '2026-08-20T00:00:00.000Z',
              decidedAt: '2026-08-21T00:00:00.000Z',
              rejectionReason:
                requestStatus === 'REJECTED' ? '합성 소속 확인 실패' : null,
            },
      );
      return;
    }
    if (pathname.endsWith('/onboarding/role')) {
      await fulfillJson(route, { selectedRole: null });
      return;
    }
    if (pathname.endsWith('/users/me/profile')) {
      await fulfillJson(route, EMPTY_PROFILE);
      return;
    }
    await fulfillJson(route, {});
  });
  return {
    setRequestStatus(status) {
      requestStatus = status;
    },
  };
}

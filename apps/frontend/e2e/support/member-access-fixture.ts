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

async function fulfillJson(route: Route, body: unknown, status = 200) {
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
  await page.route('**/api/v1/auth/session', (route) =>
    fulfillJson(route, sessionBody(authority)),
  );
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
      const authority: SyntheticAuthority = {
        role: completed && selectedKind === 'STUDENT' ? 'STUDENT' : null,
        memberKind: completed ? selectedKind : null,
        hasStaffAccess: false,
        hasAdminAccess: false,
        isProfileComplete: completed && selectedKind === 'STUDENT',
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
    await route.continue();
  });

  return { selectedKind: () => selectedKind };
}

export async function installUnassignedFixture(
  page: Page,
  requestStatus: 'REJECTED' | 'REVOKED',
): Promise<void> {
  await page.route('**/api/v1/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/auth/session')) {
      await fulfillJson(
        route,
        sessionBody({
          role: null,
          memberKind: 'STAFF',
          hasStaffAccess: false,
          hasAdminAccess: false,
          isProfileComplete: false,
        }),
      );
      return;
    }
    if (pathname.endsWith('/role-requests/me')) {
      await fulfillJson(route, {
        id: `synthetic-${requestStatus.toLowerCase()}`,
        status: requestStatus,
        requestedAt: '2026-08-20T00:00:00.000Z',
        decidedAt: '2026-08-21T00:00:00.000Z',
        rejectionReason:
          requestStatus === 'REJECTED' ? '합성 소속 확인 실패' : null,
      });
      return;
    }
    if (pathname.endsWith('/onboarding/role')) {
      await fulfillJson(route, { selectedRole: null });
      return;
    }
    await route.continue();
  });
}

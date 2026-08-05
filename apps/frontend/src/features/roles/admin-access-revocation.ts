import type { AdminAccessRole } from './admin-access-api';

export interface AdminAccessRevocation {
  readonly desiredRole: AdminAccessRole | null;
  readonly actionCaption: string;
  readonly dialogDescription: (githubLogin: string) => string;
}

const REVOCATION_BY_ROLE: Partial<
  Record<AdminAccessRole, AdminAccessRevocation>
> = {
  ADMIN: {
    desiredRole: 'STAFF',
    actionCaption: '교직원으로 전환',
    dialogDescription: (githubLogin) =>
      `${githubLogin}님의 관리자 권한을 회수하고 교직원으로 전환합니다.`,
  },
  STAFF: {
    desiredRole: null,
    actionCaption: '교직원 권한 제거',
    dialogDescription: (githubLogin) =>
      `${githubLogin}님의 교직원 권한을 회수하고 역할을 비웁니다. 이후 학생 또는 교직원 역할을 다시 선택할 수 있습니다.`,
  },
};

export function adminAccessRevocation(
  role: AdminAccessRole | null,
): AdminAccessRevocation | null {
  return role === null ? null : (REVOCATION_BY_ROLE[role] ?? null);
}

export function requireAdminAccessRevocation(
  role: AdminAccessRole | null,
): AdminAccessRevocation {
  const revocation = adminAccessRevocation(role);
  if (revocation === null) {
    throw new Error(
      '이 작업은 현재 상태에서 사용할 수 없습니다 (회수 대상 역할 없음).',
    );
  }
  return revocation;
}

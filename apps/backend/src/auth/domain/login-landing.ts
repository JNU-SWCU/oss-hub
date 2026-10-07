import type { AuthUser } from './auth-user';

const ONBOARDING_ENTRY_PATH = '/consent';

export function loginLandingUrl(
  frontendUrl: string,
  login: {
    readonly user: Pick<
      AuthUser,
      'memberKind' | 'hasStaffAccess' | 'hasAdminAccess' | 'isProfileComplete'
    >;
    readonly isNew: boolean;
  },
): string {
  const needsOnboarding =
    login.isNew ||
    !hasAssignedAccess(login.user) ||
    !login.user.isProfileComplete;
  return needsOnboarding
    ? `${frontendUrl}${ONBOARDING_ENTRY_PATH}`
    : frontendUrl;
}

function hasAssignedAccess(
  user: Pick<AuthUser, 'memberKind' | 'hasStaffAccess' | 'hasAdminAccess'>,
): boolean {
  return (
    user.memberKind === 'STUDENT' || user.hasStaffAccess || user.hasAdminAccess
  );
}

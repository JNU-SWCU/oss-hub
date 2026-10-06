import type { ProfileRole } from '@/features/profile/profile-requirements';
import type { StaffAccessRequestStatus } from '@/features/roles/types';

export type ProfileCheckStatus =
  'checking' | 'complete' | 'incomplete' | 'error';

type OnboardingPath =
  '/onboarding/profile' | '/onboarding/role' | '/onboarding/pending';

export function isClosedStaffAccessRequest(
  requestStatus: StaffAccessRequestStatus | null,
): boolean {
  return requestStatus === 'REVOKED' || requestStatus === 'REJECTED';
}

export function onboardingPathFor(
  requestStatus: StaffAccessRequestStatus | null,
): '/onboarding/role' | '/onboarding/pending';
export function onboardingPathFor(
  requestStatus: StaffAccessRequestStatus | null,
  profileStatus: ProfileCheckStatus,
): OnboardingPath | null;
export function onboardingPathFor(
  requestStatus: StaffAccessRequestStatus | null,
  profileStatus: ProfileCheckStatus = 'complete',
): OnboardingPath | null {
  if (requestStatus === null) {
    return '/onboarding/role';
  }

  if (isClosedStaffAccessRequest(requestStatus)) {
    return '/onboarding/role';
  }

  switch (profileStatus) {
    case 'checking':
    case 'error':
      return null;
    case 'incomplete':
      return '/onboarding/profile';
    case 'complete':
      return '/onboarding/pending';
  }
}

export function effectiveProfileRole(
  role: ProfileRole | null,
  requestStatus: StaffAccessRequestStatus | null,
  selectedRole: ProfileRole | null = null,
): ProfileRole | null {
  if (role !== null) {
    return role;
  }
  if (requestStatus === 'PENDING' || requestStatus === 'APPROVED') {
    return 'STAFF';
  }
  return selectedRole;
}

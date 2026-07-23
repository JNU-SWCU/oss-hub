import type { RoleRequestStatus } from '@/features/roles/types';

export type ProfileCheckStatus =
  'checking' | 'complete' | 'incomplete' | 'error';

type OnboardingPath =
  '/onboarding/profile' | '/onboarding/role' | '/onboarding/pending';

export function onboardingPathFor(
  requestStatus: RoleRequestStatus | null,
): '/onboarding/role' | '/onboarding/pending';
export function onboardingPathFor(
  requestStatus: RoleRequestStatus | null,
  profileStatus: ProfileCheckStatus,
): OnboardingPath | null;
export function onboardingPathFor(
  requestStatus: RoleRequestStatus | null,
  profileStatus: ProfileCheckStatus = 'complete',
): OnboardingPath | null {
  switch (profileStatus) {
    case 'checking':
    case 'error':
      return null;
    case 'incomplete':
      return '/onboarding/profile';
    case 'complete':
      break;
  }

  switch (requestStatus) {
    case null:
    case 'REVOKED':
      return '/onboarding/role';
    case 'PENDING':
    case 'REJECTED':
    case 'APPROVED':
      return '/onboarding/pending';
  }
}

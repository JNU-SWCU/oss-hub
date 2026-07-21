import type { RoleRequestStatus } from '@/features/roles/types';

export function onboardingPathFor(
  requestStatus: RoleRequestStatus | null,
): '/onboarding/role' | '/onboarding/pending' {
  return requestStatus === null ? '/onboarding/role' : '/onboarding/pending';
}

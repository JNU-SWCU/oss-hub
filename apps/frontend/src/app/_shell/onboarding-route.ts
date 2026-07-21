import type { RoleRequestStatus } from '@/features/roles/types';

export function onboardingPathFor(
  requestStatus: RoleRequestStatus | null,
): '/onboarding/role' | '/onboarding/pending' {
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

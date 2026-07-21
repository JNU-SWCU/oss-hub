'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

import { onboardingPathFor } from './onboarding-route';
import { roleHomePath } from './role';
import { useSessionRole } from './use-session-role';

type OnboardingTarget = 'role' | 'pending';

const TARGET_PATH: Record<
  OnboardingTarget,
  '/onboarding/role' | '/onboarding/pending'
> = {
  role: '/onboarding/role',
  pending: '/onboarding/pending',
};

export function OnboardingGate({
  target,
  children,
}: {
  readonly target: OnboardingTarget;
  readonly children: ReactNode;
}) {
  const router = useRouter();
  const { status, role, roleRequestStatus } = useSessionRole();
  const expectedPath = onboardingPathFor(roleRequestStatus);

  useEffect(() => {
    if (status === 'anonymous') {
      router.replace('/');
      return;
    }
    if (status === 'assigned' && role) {
      router.replace(roleHomePath(role));
      return;
    }
    if (status === 'unassigned' && TARGET_PATH[target] !== expectedPath) {
      router.replace(expectedPath);
    }
  }, [expectedPath, role, router, status, target]);

  const isAllowed =
    status === 'unassigned' && TARGET_PATH[target] === expectedPath;

  if (!isAllowed) {
    return (
      <p className="p-6 text-sm text-muted-foreground" role="status">
        확인 중…
      </p>
    );
  }

  return <>{children}</>;
}

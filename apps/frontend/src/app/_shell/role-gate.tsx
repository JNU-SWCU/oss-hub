'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { AccessDenied } from './access-denied';
import { LoginRequiredNotice } from './login-required-notice';
import { onboardingPathFor } from './onboarding-route';
import { SessionError } from './session-error';
import { SessionRoleProvider } from './session-role-context';
import { useSessionRole } from './use-session-role';
import type { SessionRoleState } from './use-session-role';
import { hasMemberSurface, type MemberSurface } from './member-access';

export function roleGateRedirectPath(state: SessionRoleState): string | null {
  switch (state.status) {
    case 'loading':
      return null;

    case 'error':
      return null;

    case 'anonymous':
      return null;
    case 'unassigned':
      return onboardingPathFor(state.staffAccessRequestStatus);

    case 'assigned':
      return state.isProfileComplete ? null : '/onboarding/profile';
    default: {
      const exhaustive: never = state.status;
      return exhaustive;
    }
  }
}

export function roleGateDeniedHomePath(deniedPath?: string): string {
  return deniedPath ?? '/dashboard';
}

export type UnassignedAccessPolicy = (state: SessionRoleState) => boolean;

export function shouldOpenForUnassigned(
  state: SessionRoleState,
  policy: UnassignedAccessPolicy | undefined,
): boolean {
  if (state.status !== 'unassigned' || policy === undefined) {
    return false;
  }
  return policy(state);
}

export function RoleGate({
  allow,
  deniedPath,
  unassignedAccess,
  unassignedNotice,
  children,
}: {
  allow: readonly MemberSurface[];
  deniedPath?: string;
  unassignedAccess?: UnassignedAccessPolicy;
  unassignedNotice?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const state = useSessionRole();
  const { status, retry } = state;
  const openForUnassigned = shouldOpenForUnassigned(state, unassignedAccess);

  useEffect(() => {
    if (shouldOpenForUnassigned(state, unassignedAccess)) {
      return;
    }
    const redirectPath = roleGateRedirectPath(state);
    if (!redirectPath) {
      return;
    }
    router.replace(redirectPath);
  }, [state, unassignedAccess, router]);

  const isAllowed =
    status === 'assigned' &&
    hasMemberSurface(state, allow) &&
    state.isProfileComplete;

  let content: ReactNode;
  if (status === 'error') {
    content = <SessionError onRetry={retry} />;
  } else if (status === 'anonymous') {
    content = <LoginRequiredNotice />;
  } else if (
    status === 'assigned' &&
    state.isProfileComplete &&
    !hasMemberSurface(state, allow)
  ) {
    content = <AccessDenied homePath={roleGateDeniedHomePath(deniedPath)} />;
  } else if (openForUnassigned) {
    content = (
      <>
        {unassignedNotice}
        {children}
      </>
    );
  } else if (!isAllowed) {
    content = (
      <p
        className="flex min-h-[50svh] items-center justify-center px-6 py-16 text-sm text-muted-foreground"
        role="status"
      >
        확인 중…
      </p>
    );
  } else {
    content = children;
  }

  return <SessionRoleProvider value={state}>{content}</SessionRoleProvider>;
}

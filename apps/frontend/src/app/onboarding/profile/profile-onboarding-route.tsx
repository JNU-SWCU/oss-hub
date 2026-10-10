'use client';

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ConsentRequiredDialog } from '@/features/consents/components/consent-required-dialog';
import { ProfileOnboardingScreen } from '@/features/profile/components/profile-onboarding-screen';
import type { ProfileMemberKind } from '@/features/profile/profile-requirements';
import {
  isClosedStaffAccessRequest,
  onboardingPathFor,
} from '../../_shell/onboarding-route';
import { roleHomePath } from '../../_shell/role';
import { SessionError } from '../../_shell/session-error';
import {
  useSessionRole,
  type SessionRoleState,
} from '../../_shell/use-session-role';

type ProfileOnboardingState = SessionRoleState;

const LANDING_PATH = '/';

const ROLE_PATH = '/onboarding/role';

export type ProfileOnboardingView =
  | { readonly kind: 'pending' }
  | { readonly kind: 'error' }
  | {
      readonly kind: 'redirect';
      readonly path: typeof LANDING_PATH | typeof ROLE_PATH;
    }
  | {
      readonly kind: 'form';
      readonly memberKind: ProfileMemberKind;
      readonly nextPath: string;

      readonly canChangeRole: boolean;
    };

function signupDestination(state: ProfileOnboardingState): string {
  if (state.memberKind !== null) {
    return '/dashboard';
  }
  if (state.hasAdminAccess) {
    return '/dashboard/users';
  }
  switch (state.selectedRole) {
    case 'STUDENT':
      return roleHomePath();
    case 'STAFF':
      return '/onboarding/pending';
    case null:
      return onboardingPathFor(state.staffAccessRequestStatus);
  }
}

function profileMemberKind(
  state: ProfileOnboardingState,
): ProfileMemberKind | null {
  if (state.memberKind !== null) return state.memberKind;
  if (state.selectedRole !== null) return state.selectedRole;
  return state.staffAccessRequestStatus === 'PENDING' ||
    state.staffAccessRequestStatus === 'APPROVED'
    ? 'STAFF'
    : null;
}

export function profileOnboardingView(
  state: ProfileOnboardingState,
): ProfileOnboardingView {
  switch (state.status) {
    case 'loading':
    case 'anonymous':
      return { kind: 'pending' };
    case 'error':
      return { kind: 'error' };
    case 'unassigned':
    case 'assigned':
      if (
        state.status === 'unassigned' &&
        state.staffAccessRequestStatus === null &&
        state.selectedRole === null
      ) {
        return { kind: 'redirect', path: LANDING_PATH };
      }

      if (
        state.status === 'unassigned' &&
        isClosedStaffAccessRequest(state.staffAccessRequestStatus)
      ) {
        return { kind: 'redirect', path: ROLE_PATH };
      }

      const memberKind = profileMemberKind(state);
      if (memberKind === null) {
        return { kind: 'redirect', path: ROLE_PATH };
      }
      return {
        kind: 'form',
        memberKind,
        nextPath: signupDestination(state),

        canChangeRole:
          state.status === 'unassigned' &&
          state.staffAccessRequestStatus === null,
      };
    default: {
      const exhaustive: never = state.status;
      return exhaustive;
    }
  }
}

export function ProfileOnboardingRoute() {
  const state = useSessionRole();
  const view = profileOnboardingView(state);

  if (view.kind === 'error') {
    return <SessionError onRetry={state.retry} />;
  }

  if (view.kind === 'redirect') {
    redirect(view.path);
  }

  if (view.kind === 'pending') {
    return (
      <p
        className="flex min-h-[50svh] items-center justify-center px-6 py-16 text-sm text-muted-foreground"
        role="status"
      >
        확인 중…
      </p>
    );
  }

  return (
    <>
      <ProfileOnboardingScreen
        memberKind={view.memberKind}
        nextPath={view.nextPath}
        renderConsentRequired={(props) => <ConsentRequiredDialog {...props} />}
      />
      {view.canChangeRole ? <ChangeRoleLink /> : null}
    </>
  );
}

function ChangeRoleLink() {
  return (
    <p className="text-small text-cosmos-muted">
      <Link
        href={ROLE_PATH}
        className="underline underline-offset-4 hover:text-cosmos-copy"
      >
        역할을 다시 고르기
      </Link>
      {' — 아직 확정되지 않았습니다.'}
    </p>
  );
}

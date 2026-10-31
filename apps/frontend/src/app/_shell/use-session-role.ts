'use client';

import { useCallback, useMemo } from 'react';
import { useSession } from '@/features/auth/use-session';
import { useOnboardingStatusQuery } from '@/features/roles/onboarding/queries';
import type {
  StaffAccessRequestStatus,
  RoleSelection,
} from '@/features/roles/onboarding/types';
import {
  EMPTY_MEMBER_ACCESS,
  memberSurfaces,
  type MemberAccess,
} from './member-access';
import { useOptionalSharedSessionRole } from './session-role-context';

export type SessionStatus =
  'loading' | 'error' | 'anonymous' | 'unassigned' | 'assigned';

function hasUsableSurface(user: MemberAccess): boolean {
  return memberSurfaces(user).length > 0;
}

export interface SessionRoleState extends MemberAccess {
  readonly status: SessionStatus;
  readonly staffAccessRequestStatus: StaffAccessRequestStatus | null;

  readonly staffAccessRequestRejectionReason: string | null;

  readonly selectedRole: RoleSelection | null;

  readonly isProfileComplete: boolean;
}

export interface SessionRoleResult extends SessionRoleState {
  retry: () => void;
}

const LOADING: SessionRoleState = {
  status: 'loading',
  ...EMPTY_MEMBER_ACCESS,
  staffAccessRequestStatus: null,
  staffAccessRequestRejectionReason: null,
  selectedRole: null,
  isProfileComplete: false,
};
const ERROR: SessionRoleState = {
  status: 'error',
  ...EMPTY_MEMBER_ACCESS,
  staffAccessRequestStatus: null,
  staffAccessRequestRejectionReason: null,
  selectedRole: null,
  isProfileComplete: false,
};
const ANONYMOUS: SessionRoleState = {
  status: 'anonymous',
  ...EMPTY_MEMBER_ACCESS,
  staffAccessRequestStatus: null,
  staffAccessRequestRejectionReason: null,
  selectedRole: null,
  isProfileComplete: false,
};

function useOwnedSessionRole(enabled: boolean): SessionRoleResult {
  const session = useSession();

  const onboardingSubject =
    enabled &&
    session.status === 'authenticated' &&
    session.user !== null &&
    !hasUsableSurface(session.user)
      ? session.user.nickname
      : null;

  const onboarding = useOnboardingStatusQuery(onboardingSubject);
  const { refetch } = onboarding;
  const retry = useCallback(() => {
    if (onboardingSubject !== null) void refetch();
    session.retry();
  }, [onboardingSubject, refetch, session]);

  const state = useMemo<SessionRoleState>(() => {
    switch (session.status) {
      case 'loading':
        return LOADING;
      case 'error':
        return ERROR;
      case 'anonymous':
        return ANONYMOUS;
      case 'authenticated': {
        const user = session.user;
        if (user === null) return LOADING;
        if (hasUsableSurface(user)) {
          return {
            status: 'assigned',
            memberKind: user.memberKind,
            hasStaffAccess: user.hasStaffAccess,
            hasAdminAccess: user.hasAdminAccess,
            staffAccessRequestStatus: null,
            staffAccessRequestRejectionReason: null,
            selectedRole: null,
            isProfileComplete: user.isProfileComplete,
          };
        }
        if (onboardingSubject === null) {
          return LOADING;
        }
        switch (onboarding.status) {
          case 'pending':
            return LOADING;
          case 'error':
            return ERROR;
          case 'success':
            return {
              status: 'unassigned',
              memberKind: user.memberKind,
              hasStaffAccess: user.hasStaffAccess,
              hasAdminAccess: user.hasAdminAccess,
              staffAccessRequestStatus: onboarding.data.request?.status ?? null,
              staffAccessRequestRejectionReason:
                onboarding.data.request?.status === 'REJECTED'
                  ? (onboarding.data.request.rejectionReason ?? null)
                  : null,
              selectedRole: onboarding.data.selection.selectedRole,
              isProfileComplete: false,
            };
          default: {
            const exhaustive: never = onboarding;
            return exhaustive;
          }
        }
      }
      default: {
        const exhaustive: never = session.status;
        return exhaustive;
      }
    }
  }, [onboarding, onboardingSubject, session.status, session.user]);

  return useMemo(() => ({ ...state, retry }), [retry, state]);
}

export function useSessionRole(): SessionRoleResult {
  const shared = useOptionalSharedSessionRole();
  const owned = useOwnedSessionRole(shared === null);
  return shared ?? owned;
}

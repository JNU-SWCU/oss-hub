'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from '@/features/auth/use-session';
import {
  fetchMyStaffAccessRequest,
  fetchMyRoleSelection,
} from '@/features/roles/api';
import type {
  StaffAccessRequestStatus,
  RoleSelection,
} from '@/features/roles/types';
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

type OnboardingFetch =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'loaded';

      readonly subject: string;
      readonly status: StaffAccessRequestStatus | null;

      readonly rejectionReason: string | null;
      readonly selectedRole: RoleSelection | null;
    }
  | { readonly kind: 'failed'; readonly subject: string };

function useOwnedSessionRole(enabled: boolean): SessionRoleResult {
  const session = useSession();
  const [onboarding, setOnboarding] = useState<OnboardingFetch>({
    kind: 'idle',
  });
  const [refreshGeneration, setRefreshGeneration] = useState(0);

  const onboardingSubject =
    enabled &&
    session.status === 'authenticated' &&
    session.user !== null &&
    !hasUsableSurface(session.user)
      ? session.user.nickname
      : null;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    if (onboardingSubject === null) {
      setOnboarding({ kind: 'idle' });
      return;
    }

    let active = true;
    Promise.all([fetchMyStaffAccessRequest(), fetchMyRoleSelection()])
      .then(([request, selection]) => {
        if (active) {
          setOnboarding({
            kind: 'loaded',
            subject: onboardingSubject,
            status: request?.status ?? null,

            rejectionReason:
              request?.status === 'REJECTED'
                ? (request.rejectionReason ?? null)
                : null,
            selectedRole: selection.selectedRole,
          });
        }
      })
      .catch(() => {
        if (active) {
          setOnboarding({ kind: 'failed', subject: onboardingSubject });
        }
      });

    return () => {
      active = false;
    };
  }, [enabled, onboardingSubject, refreshGeneration]);

  const retry = useCallback(() => {
    setOnboarding({ kind: 'idle' });

    setRefreshGeneration((current) => current + 1);
    session.retry();
  }, [session]);

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
        switch (onboarding.kind) {
          case 'idle':
            return LOADING;
          case 'failed':
            return onboarding.subject === onboardingSubject ? ERROR : LOADING;
          case 'loaded':
            if (onboarding.subject !== onboardingSubject) {
              return LOADING;
            }
            return {
              status: 'unassigned',
              memberKind: user.memberKind,
              hasStaffAccess: user.hasStaffAccess,
              hasAdminAccess: user.hasAdminAccess,
              staffAccessRequestStatus: onboarding.status,
              staffAccessRequestRejectionReason: onboarding.rejectionReason,
              selectedRole: onboarding.selectedRole,
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

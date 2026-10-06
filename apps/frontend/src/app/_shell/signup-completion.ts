import { SIGNUP_FLOW_PATHS } from './signup-routes';
import type { SessionRoleState } from './use-session-role';

export type SignupCompletionState = Pick<
  SessionRoleState,
  'status' | 'staffAccessRequestStatus' | 'isProfileComplete'
>;

export function isSignupComplete(state: SignupCompletionState): boolean {
  switch (state.status) {
    case 'loading':
    case 'error':
    case 'anonymous':
      return false;
    case 'assigned':
      return state.isProfileComplete;
    case 'unassigned':
      return (
        state.staffAccessRequestStatus === 'PENDING' ||
        state.staffAccessRequestStatus === 'APPROVED'
      );
    default: {
      const exhaustive: never = state.status;
      return exhaustive;
    }
  }
}

export function shouldShowAccountSlot(
  state: SignupCompletionState,
  pathname: string,
): boolean {
  return (
    state.status === 'anonymous' ||
    isSignupComplete(state) ||
    SIGNUP_FLOW_PATHS.has(pathname)
  );
}

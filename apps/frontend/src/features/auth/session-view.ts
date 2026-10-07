import type { AuthSessionState } from './session-store';
import type { AuthSession } from './types';

export function toAccountMenuSession(
  state: AuthSessionState,
): AuthSession | null {
  switch (state.status) {
    case 'loading':
    case 'error':
      return null;
    case 'anonymous':
      return { isAuthenticated: false };
    case 'authenticated':
      return state.user === null
        ? null
        : { isAuthenticated: true, user: state.user };
    default: {
      const exhaustive: never = state.status;
      return exhaustive;
    }
  }
}

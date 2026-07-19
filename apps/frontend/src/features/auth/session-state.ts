import type { LogoutResult, Me } from './types';

export interface AuthSessionState {
  me: Me | null;
  logoutError: string | null;
}

export const LOGOUT_ERROR_MESSAGE =
  '로그아웃하지 못했습니다. 잠시 후 다시 시도해 주세요.';

export function applyLogoutSuccess(
  previous: AuthSessionState,
  result: LogoutResult,
): AuthSessionState {
  if (result.isAuthenticated) {
    return { ...previous, logoutError: null };
  }
  return { me: null, logoutError: null };
}

export function applyLogoutFailure(
  previous: AuthSessionState,
): AuthSessionState {
  return { ...previous, logoutError: LOGOUT_ERROR_MESSAGE };
}

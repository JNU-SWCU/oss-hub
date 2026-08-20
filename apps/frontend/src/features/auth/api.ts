import { apiClient } from '@/lib/api-client';
import type { AuthSession, LogoutResult } from './types';

// OAuth 진입 경로 상수는 여기 두지 않는다. auth feature 안에서 그 경로를 직접
// 거는 화면이 더 이상 없고(nav의 LoginButton은 `/signup`으로 간다), 남겨 두면
// 다음 사람이 "로그인 버튼이니 이걸 쓰면 되겠다"며 안내 없는 막다른 길을 다시
// 만든다. OAuth를 실제로 시작하는 곳은 `/signup` 화면 하나뿐이다.

export function fetchSession(): Promise<AuthSession> {
  return apiClient<AuthSession>('auth/session');
}

export function logout(): Promise<LogoutResult> {
  return apiClient<LogoutResult>('auth/logout', { method: 'POST' });
}

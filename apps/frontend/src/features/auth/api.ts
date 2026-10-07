import { apiClient } from '@/lib/api-client';
import type { AuthSession, LogoutResult } from './types';

export function fetchSession(): Promise<AuthSession> {
  return apiClient<AuthSession>('auth/session');
}

export function logout(): Promise<LogoutResult> {
  return apiClient<LogoutResult>('auth/logout', { method: 'POST' });
}

/**
 * 라우트 골격·역할별 패널 셸 (#136) 전용 역할 상수.
 * 백엔드 `AUTH_INITIAL_ROLES`가 허용하는 역할과 동일한 값 집합이다.
 */
import type { AuthRole } from '@/features/auth/types';

export type AppRole = AuthRole;

/** 역할 불일치 시 되돌아갈 "자기 역할 홈". #107 공식 권한 흐름의 목적지를 따른다. */
export function roleHomePath(role: AppRole): string {
  if (role === 'STUDENT') return '/dashboard';
  if (role === 'STAFF') return '/staff/dashboard';
  return '/admin/staff-requests';
}

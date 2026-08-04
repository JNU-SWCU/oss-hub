/**
 * 라우트 골격·역할별 패널 셸 (#136) 전용 역할 상수.
 * 백엔드 `AUTH_INITIAL_ROLES`가 허용하는 역할과 동일한 값 집합이다.
 */
import type { AuthRole } from '@/features/auth/types';

export type AppRole = AuthRole;

/**
 * 회원 공통 역할 홈 입구.
 *
 * 세션 쿠키 JWT에는 `sub`(githubId)만 있고 역할 클레임은 없다. 역할은 DB
 * `User.role`에 저장되며 `/auth/me`가 세션 주체로 조회해 내려준다. 프론트는 그
 * 값으로 `/dashboard` **본문만** 가르고, URL 입구는 역할과 무관하게 하나다.
 *
 * `_role`은 호출부·테스트 시그니처를 유지하기 위해 받는다(역할별 경로는 쓰지 않음).
 */
export function roleHomePath(_role: AppRole): string {
  return '/dashboard';
}

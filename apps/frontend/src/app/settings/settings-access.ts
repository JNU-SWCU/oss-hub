import type { AppRole } from '../_shell/role';

/**
 * 설정(#156) 접근 허용 역할 — 역할이 확정된 모든 사용자.
 *
 * 로그인만 확인하던 `AuthGate`로는 부족했다. 가입을 끝내지 않은(역할 미배정)
 * 사용자가 프로필·알림 설정을 먼저 바꿀 수 있었고, 그 값은 곧이어 온보딩의
 * 프로필 입력이 다시 덮어쓴다. 대시보드와 같은 규칙으로 온보딩을 먼저 마치게 한다.
 *
 * 특정 역할을 가리는 화면이 아니므로 세 역할을 모두 허용한다 — 여기서 걸러야 할
 * 것은 "어떤 역할인가"가 아니라 "역할이 있는가"다.
 */
export const SETTINGS_ALLOWED_ROLES: readonly AppRole[] = [
  'STUDENT',
  'STAFF',
  'ADMIN',
];

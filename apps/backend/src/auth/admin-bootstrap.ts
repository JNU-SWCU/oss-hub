import { Role } from '@prisma/client';

/**
 * 초기 관리자 2명 부트스트랩 (Issue #109).
 * 별도 관리자 화면 없이, 로그인(upsert) 시점에 GitHub login 기준으로 ADMIN을 부여한다.
 * 이미 role이 설정된 사용자는 덮어쓰지 않는다 — 호출자(auth.repository.ts)가 role===null일 때만 사용한다.
 */
const ADMIN_BOOTSTRAP_LOGINS = new Set(
  ['GoBeromsu', 'Lumiere001'].map((login) => login.toLowerCase()),
);

export function resolveBootstrapRole(login: string): Role | null {
  return ADMIN_BOOTSTRAP_LOGINS.has(login.toLowerCase()) ? Role.ADMIN : null;
}

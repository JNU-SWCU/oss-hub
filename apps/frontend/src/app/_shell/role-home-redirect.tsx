'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSessionRole, type SessionStatus } from './use-session-role';
import { roleHomePath, type AppRole } from './role';

/**
 * 로그인 상태(#107 role 확정)로 랜딩(`/`)에 들어온 사용자만 자기 역할 홈으로
 * 보낼 대상 경로를 고른다. OAuth 콜백 성공 시 backend가 `/`로 302시키므로,
 * "로그인 직후 랜딩 착지 → 역할 홈 이동"의 마지막 판단이 이 함수다.
 * 비로그인(anonymous)·역할 미확정(unassigned)·확인 중(loading)은 랜딩 그대로
 * 둔다 — null 반환.
 */
export function resolveRoleHomeRedirect(
  status: SessionStatus,
  role: AppRole | null,
): string | null {
  if (status === 'assigned' && role) return roleHomePath(role);
  return null;
}

/**
 * 랜딩 전용 리다이렉트 side-effect 컴포넌트 (#136). 화면을 그리지 않고
 * 세션·role만 관찰한다 — 비로그인 다수가 확인 중 빈 화면을 보지 않도록
 * 랜딩 본문(children 아님, 형제로 렌더)은 세션 확인과 무관하게 그대로 노출된다.
 */
export function RoleHomeRedirect() {
  const router = useRouter();
  const { status, role } = useSessionRole();

  useEffect(() => {
    const target = resolveRoleHomeRedirect(status, role);
    if (target) router.replace(target);
  }, [status, role, router]);

  return null;
}

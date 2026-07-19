'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useSessionRole, type SessionStatus } from './use-session-role';
import { roleHomePath, type AppRole } from './role';

/**
 * 로그인 상태(#107 role 확정)로 랜딩(`/`)에 들어온 사용자가 자기 역할 홈으로
 * 이동할 nav 링크의 대상 경로를 고른다. #144가 도입한 `/` 진입 시 자동
 * router.replace 리다이렉트는 뒤로가기 함정(back-trap: /dashboard→뒤로→/→
 * 즉시 재리다이렉트로 뒤로가기 무력화)과 랜딩 도달 불가 문제로 제거됐다
 * (#136 PM 결정) — `/`는 항상 랜딩을 렌더하고, 대신 nav 링크로 역할 홈
 * 진입을 제공한다. 비로그인(anonymous)·역할 미확정(unassigned)·확인
 * 중(loading)은 null.
 */
export function resolveRoleHome(
  status: SessionStatus,
  role: AppRole | null,
): string | null {
  if (status === 'assigned' && role) return roleHomePath(role);
  return null;
}

/** nav 링크 라벨 — `role-menus.ts`의 역할별 첫 메뉴 라벨과 맞춘다. */
export const ROLE_HOME_LABEL: Record<AppRole, string> = {
  STUDENT: '내 대시보드',
  STAFF: '운영 대시보드',
  ADMIN: '교직원 승인',
};

/**
 * nav actions 슬롯의 역할 홈 진입 링크 (#136). role이 확정된 사용자에게만
 * 노출되고, 그 외(비로그인·미확정·확인 중)는 아무것도 렌더하지 않는다 —
 * side-effect 리다이렉트 없이 사용자가 직접 클릭해 이동한다.
 */
export function RoleHomeNavLink() {
  const { status, role } = useSessionRole();
  if (status !== 'assigned' || !role) return null;

  const target = resolveRoleHome(status, role);
  if (!target) return null;

  return (
    <Button asChild variant="ghost">
      <Link href={target}>{ROLE_HOME_LABEL[role]}</Link>
    </Button>
  );
}

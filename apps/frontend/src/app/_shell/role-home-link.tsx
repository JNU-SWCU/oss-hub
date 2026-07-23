'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useSessionRole, type SessionStatus } from './use-session-role';
import { roleHomePath, type AppRole } from './role';
import { ADMIN_MENU, STAFF_MENU, STUDENT_MENU } from './role-menus';

/**
 * nav 링크 라벨 — 리터럴을 따로 두지 않고 `role-menus.ts`의 역할별 첫 메뉴
 * 라벨에서 파생시켜, 두 값이 갈라질 수 없게 한다.
 */
export const ROLE_HOME_LABEL: Record<AppRole, string> = {
  STUDENT: STUDENT_MENU[0].label,
  STAFF: STAFF_MENU[0].label,
  ADMIN: ADMIN_MENU[0].label,
};

interface SessionEntry {
  readonly href: string;
  readonly label: string;
  readonly compactLabel: string;
}

const ONBOARDING_ENTRY = {
  href: '/consent',
  label: '가입 계속하기',
  compactLabel: '가입 계속',
} as const satisfies SessionEntry;

/**
 * 랜딩은 항상 볼 수 있게 두고, 세션 상태에 맞는 다음 행동만 nav에 제공한다.
 * 역할 미확정 사용자는 `/consent`에서 시작한다. 기존 ConsentFlow가 현행 동의를
 * 확인해 미동의자는 동의 화면을, 동의 완료자는 역할 온보딩을 이어서 보여 준다.
 */
export function resolveSessionEntry(
  status: SessionStatus,
  role: AppRole | null,
): SessionEntry | null {
  switch (status) {
    case 'loading':
    case 'anonymous':
      return null;
    case 'unassigned':
      return ONBOARDING_ENTRY;
    case 'assigned':
      return role
        ? {
            href: roleHomePath(role),
            label: ROLE_HOME_LABEL[role],
            compactLabel: '대시보드',
          }
        : null;
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

/**
 * nav actions 슬롯의 세션별 진입 링크. 자동 리다이렉트 없이 사용자가 직접
 * 클릭해 이동하므로 랜딩 뒤로가기 함정을 만들지 않는다.
 */
export function SessionEntryNavLink() {
  const { status, role } = useSessionRole();
  const destination = resolveSessionEntry(status, role);
  if (!destination) return null;

  return (
    <Button asChild variant="ghost">
      <Link href={destination.href} aria-label={destination.label}>
        <span className="sm:hidden">{destination.compactLabel}</span>
        <span className="hidden sm:inline">{destination.label}</span>
      </Link>
    </Button>
  );
}

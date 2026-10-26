'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useSessionRole, type SessionStatus } from './use-session-role';
import type { MemberAccess } from './member-access';
import { ADMIN_SYSTEM_MENU, STAFF_MENU, STUDENT_MENU } from './role-menus';

const STUDENT_HOME: SessionEntry = {
  href: '/dashboard',
  label: STUDENT_MENU[0].label,
  compactLabel: '대시보드',
};
const STAFF_HOME: SessionEntry = {
  href: '/dashboard',
  label: STAFF_MENU[0].label,
  compactLabel: '대시보드',
};
const CONTINUE_SIGNUP: SessionEntry = {
  href: '/consent',
  label: '가입 이어하기',
  compactLabel: '가입 이어하기',
};
const ADMIN_HOME: SessionEntry = {
  href: ADMIN_SYSTEM_MENU[0].href,
  label: ADMIN_SYSTEM_MENU[0].label,
  compactLabel: '관리',
};

export const ROLE_HOME_LABEL: Record<'STUDENT' | 'STAFF' | 'ADMIN', string> = {
  STUDENT: STUDENT_HOME.label,
  STAFF: STAFF_HOME.label,
  ADMIN: ADMIN_HOME.label,
};

interface SessionEntry {
  readonly href: string;
  readonly label: string;
  readonly compactLabel: string;
}

export function resolveSessionEntry(
  status: SessionStatus,
  access: MemberAccess | null,
  isProfileComplete: boolean,
): SessionEntry | null {
  switch (status) {
    case 'loading':
    case 'anonymous':

    case 'error':
      return null;

    case 'unassigned':
      return CONTINUE_SIGNUP;
    case 'assigned':
      if (!isProfileComplete) {
        return CONTINUE_SIGNUP;
      }

      if (access?.hasStaffAccess) return STAFF_HOME;
      if (access?.memberKind === 'STUDENT') return STUDENT_HOME;
      return access?.hasAdminAccess ? ADMIN_HOME : null;
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

export function SessionEntryNavLink() {
  const session = useSessionRole();
  const { status, isProfileComplete } = session;
  const pathname = usePathname();

  if (status === 'assigned' && isProfileComplete) {
    return null;
  }
  const destination = resolveSessionEntry(status, session, isProfileComplete);

  if (!destination || destination.href === pathname) {
    return null;
  }

  return (
    <Button asChild variant="ghost">
      <Link href={destination.href} aria-label={destination.label}>
        <span className="sm:hidden">{destination.compactLabel}</span>
        <span className="hidden sm:inline">{destination.label}</span>
      </Link>
    </Button>
  );
}

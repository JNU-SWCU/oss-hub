import {
  EMPTY_MEMBER_ACCESS,
  memberSurfaces,
  type MemberAccess,
} from './member-access';
import { programDetailIdFromPathname } from './section-facets';
import { shellSectionFromPathname, sidebarGroupsFor } from './sidebar-menu';
import type { SessionStatus } from './use-session-role';

export interface ShellSession extends MemberAccess {
  readonly status: SessionStatus;
  readonly isProfileComplete: boolean;
}

export function isShellMember(session: ShellSession): boolean {
  return (
    session.status === 'assigned' &&
    session.isProfileComplete &&
    memberSurfaces(session).length > 0
  );
}

export function shellSidebarAccess(session: ShellSession): MemberAccess {
  return isShellMember(session) ? session : EMPTY_MEMBER_ACCESS;
}

export function hasShellSidebar(
  pathname: string,
  session: ShellSession,
): boolean {
  if (programDetailIdFromPathname(pathname) !== null) return true;
  return (
    sidebarGroupsFor(
      shellSectionFromPathname(pathname),
      shellSidebarAccess(session),
    ).length > 0
  );
}

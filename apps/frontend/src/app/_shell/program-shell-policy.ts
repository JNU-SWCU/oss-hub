import { createContext } from 'react';
import { programDetailIdFromPathname } from './section-facets';
import type {
  ProgramScopeSidebarGroup,
  ProgramScopeViewerRole,
} from './sidebar-menu';

export const ProgramViewContext = createContext<ProgramScopeViewerRole | null>(
  null,
);

export function isProgramOperationsPath(pathname: string): boolean {
  return /^\/programs\/[^/]+\/(?:edit|milestones\/[^/]+\/documents|submissions\/[^/]+\/review|teams\/[^/]+)\/?$/.test(
    pathname,
  );
}

export function isProgramScopedWorkspacePath(pathname: string): boolean {
  return programDetailIdFromPathname(pathname) !== null;
}

export function withoutLoadingCounts(
  groups: readonly ProgramScopeSidebarGroup[],
): readonly ProgramScopeSidebarGroup[] {
  return groups.map((group) => ({
    ...group,
    items: group.items.map((item) =>
      item.count === undefined ? item : { ...item, count: undefined },
    ),
  }));
}

export function shouldLoadProgramOverview(
  programDetailId: string | null,
  member: boolean,
): programDetailId is string {
  return programDetailId !== null && member;
}

export function shouldLoadProgramParticipation(
  programDetailId: string | null,
  member: boolean,
  studentViewer: boolean,
): programDetailId is string {
  return shouldLoadProgramOverview(programDetailId, member) && studentViewer;
}

export function programScopeViewerRole(
  member: boolean,
  authority: {
    readonly memberKind: 'STUDENT' | 'STAFF' | null;
    readonly hasStaffAccess: boolean;
    readonly hasAdminAccess?: boolean;
  },
  participant?: boolean,
  operationsView = false,
): ProgramScopeViewerRole {
  if (!member) return 'GUEST';
  if (authority.memberKind === 'STUDENT' && participant === true) {
    if (!operationsView) return 'STUDENT';
  }
  if (authority.hasAdminAccess) return 'ADMIN';
  if (authority.hasStaffAccess) return 'STAFF';
  return authority.memberKind === 'STUDENT' ? 'STUDENT' : 'GUEST';
}

import type {
  ProgramScopeSidebarGroup,
  ProgramScopeViewerRole,
} from './sidebar-menu';

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

export function programScopeViewerRole(
  member: boolean,
  authority: {
    readonly memberKind: 'STUDENT' | 'STAFF' | null;
    readonly hasStaffAccess: boolean;
  },
): ProgramScopeViewerRole {
  if (!member) return 'GUEST';
  if (authority.hasStaffAccess) return 'STAFF';
  return authority.memberKind === 'STUDENT' ? 'STUDENT' : 'GUEST';
}

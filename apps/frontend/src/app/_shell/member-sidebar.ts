import { resolveMemberAccess, type MemberAccess } from './member-access';
import {
  sidebarGroupsFor,
  type ShellSection,
  type SidebarGroup,
} from './sidebar-menu';

type SidebarOptions = NonNullable<Parameters<typeof sidebarGroupsFor>[2]>;

function dashboardGroup(
  legacyProjection: 'STUDENT' | 'STAFF' | 'ADMIN',
  label: string,
): SidebarGroup | null {
  return (
    sidebarGroupsFor('dashboard', legacyProjection).find(
      (group) => group.label === label,
    ) ?? null
  );
}

export function sidebarGroupsForMemberAccess(
  section: ShellSection,
  access: MemberAccess,
  options?: SidebarOptions,
): readonly SidebarGroup[] {
  if (section !== 'dashboard') {
    return sidebarGroupsFor(section, null, options);
  }

  const groups: SidebarGroup[] = [];
  const authority = resolveMemberAccess(access);
  if (authority.memberKind === 'STUDENT') {
    const student = dashboardGroup('STUDENT', '대시보드');
    if (student) groups.push(student);
  }
  if (authority.hasStaffAccess) {
    const staff = dashboardGroup('STAFF', '교직원');
    if (staff) groups.push(staff);
  }
  if (authority.hasAdminAccess) {
    const admin = dashboardGroup('ADMIN', '관리자');
    if (admin) groups.push(admin);
  }
  return groups;
}

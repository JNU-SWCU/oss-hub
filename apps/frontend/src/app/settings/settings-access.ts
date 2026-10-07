import type { MemberSurface } from '../_shell/member-access';
import type { SessionRoleState } from '../_shell/use-session-role';

export const SETTINGS_ALLOWED_SURFACES: readonly MemberSurface[] = [
  'student',
  'staff',
  'admin',
];

export function isSettingsOpenForStaffAwaitingRole(
  state: SessionRoleState,
): boolean {
  if (state.status !== 'unassigned') {
    return false;
  }
  return (
    state.staffAccessRequestStatus === 'PENDING' ||
    state.staffAccessRequestStatus === 'APPROVED'
  );
}

'use client';

import { SettingsScreen } from '@/features/profile/settings/components/settings-screen';
import { useSharedSessionRole } from '../_shell/session-role-context';

export function SettingsRoute() {
  const state = useSharedSessionRole();

  const memberKind =
    state.memberKind ??
    state.selectedRole ??
    (state.staffAccessRequestStatus === 'PENDING' ||
    state.staffAccessRequestStatus === 'APPROVED'
      ? 'STAFF'
      : null);

  return (
    <SettingsScreen
      memberKind={memberKind}
      hasAdminAccess={state.hasAdminAccess}
    />
  );
}

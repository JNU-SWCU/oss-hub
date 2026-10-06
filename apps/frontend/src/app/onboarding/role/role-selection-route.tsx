'use client';

import { RoleSelectionScreen } from '@/features/roles/components/role-selection-screen';
import { useSharedSessionRole } from '../../_shell/session-role-context';

export function RoleSelectionRoute() {
  const {
    staffAccessRequestStatus,
    staffAccessRequestRejectionReason,
    selectedRole,
  } = useSharedSessionRole();

  return (
    <RoleSelectionScreen
      initialSelectedRole={selectedRole}
      rejection={
        staffAccessRequestStatus === 'REJECTED'
          ? { status: 'REJECTED', reason: staffAccessRequestRejectionReason }
          : null
      }
    />
  );
}

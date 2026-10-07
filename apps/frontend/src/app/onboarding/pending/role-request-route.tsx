'use client';

import { useSharedSessionRole } from '../../_shell/session-role-context';
import { StaffAccessRequestScreen } from '@/features/roles/components/role-request-screen';

export function StaffAccessRequestRoute() {
  const { staffAccessRequestStatus, staffAccessRequestRejectionReason, retry } =
    useSharedSessionRole();

  return (
    <StaffAccessRequestScreen
      staffAccessRequestStatus={staffAccessRequestStatus}
      staffAccessRequestRejectionReason={staffAccessRequestRejectionReason}
      onRefresh={retry}
    />
  );
}

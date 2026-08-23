'use client';

import { useSharedSessionRole } from '../../_shell/session-role-context';
import { StaffAccessRequestScreen } from '@/features/roles/components/role-request-screen';

/** 게이트가 판단한 역할 요청 스냅샷을 화면 표시 값으로 그대로 건넨다. */
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

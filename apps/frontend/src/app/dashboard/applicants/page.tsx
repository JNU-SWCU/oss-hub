import { Suspense } from 'react';

import { RolePanelShell } from '../../_shell/role-panel-shell';
import { AdminAccessScreen } from '@/features/roles/components/admin-access-screen';

// 가입 신청 큐(URL: /dashboard/applicants) — 접근: STAFF·ADMIN.
// 대기 중인 교직원 StaffAccessRequest만 보여 주고 승인·반려한다. 전체 사용자 명부는
// `/dashboard/users`(ADMIN 전용)에 남긴다. 필터·정렬·페이지 상태는 URL
// searchParams라 `useSearchParams()`를 Suspense로 감싼다.
export default function ApplicantQueuePage() {
  return (
    <RolePanelShell allow={['staff']}>
      <Suspense fallback={null}>
        <AdminAccessScreen workspace="queue" />
      </Suspense>
    </RolePanelShell>
  );
}

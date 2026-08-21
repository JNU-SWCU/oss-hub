import { Suspense } from 'react';

import { RolePanelShell } from '../../_shell/role-panel-shell';
import { AdminAccessScreen } from '@/features/roles/components/admin-access-screen';

// 사용자 목록(URL: /admin/access) — 접근: ADMIN만. 역할·계정 상태·마지막
// 로그인을 조회하고 변경한다. 가입 신청 큐는 `/dashboard/applicants`
// (STAFF·ADMIN). 기존 `/admin/users`·`/admin/staff-requests`는 리다이렉트
// 없이 404. 필터·정렬·페이지 상태는 URL searchParams라 `useSearchParams()`를
// Suspense로 감싼다.
export default function AdminAccessPage() {
  return (
    <RolePanelShell allow={['admin']}>
      <Suspense fallback={null}>
        <AdminAccessScreen workspace="directory" />
      </Suspense>
    </RolePanelShell>
  );
}

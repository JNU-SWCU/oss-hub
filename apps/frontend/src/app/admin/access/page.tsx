import { Suspense } from 'react';

import { RolePanelShell } from '../../_shell/role-panel-shell';
import { AdminAccessScreen } from '@/features/roles/components/admin-access-screen';

// 통합 접근 화면(URL: /admin/access) — 접근: ADMIN만. ADMIN_MENU의 유일한
// 관리 콘솔 진입점이며(PR04H), 기존 `/admin/users`·`/admin/staff-requests`는
// 리다이렉트 없이 404로 이관됐다. 필터·정렬·페이지 상태는 URL searchParams에
// 있으므로(PR04D) `AdminAccessScreen`의 `useSearchParams()` 호출을 Suspense
// 경계로 감싼다.
export default function AdminAccessPage() {
  return (
    <RolePanelShell allow={['ADMIN']}>
      <Suspense fallback={null}>
        <AdminAccessScreen />
      </Suspense>
    </RolePanelShell>
  );
}

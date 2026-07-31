import { Suspense } from 'react';

import { RolePanelShell } from '../../_shell/role-panel-shell';
import { ADMIN_MENU } from '../../_shell/role-menus';
import { AdminAccessScreen } from '@/features/roles/components/admin-access-screen';

// 통합 접근 화면(URL: /admin/access) — 접근: ADMIN만. 읽기 전용 목록만 제공하며
// (PR04C), 기존 `/admin/users`·`/admin/staff-requests`는 원자적 전환(PR04H)
// 전까지 그대로 유지된다. 필터·정렬·페이지 상태는 URL searchParams에 있으므로
// (PR04D) `AdminAccessScreen`의 `useSearchParams()` 호출을 Suspense 경계로
// 감싼다.
export default function AdminAccessPage() {
  return (
    <RolePanelShell menu={ADMIN_MENU} allow={['ADMIN']}>
      <Suspense fallback={null}>
        <AdminAccessScreen />
      </Suspense>
    </RolePanelShell>
  );
}

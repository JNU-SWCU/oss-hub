import { Suspense } from 'react';

import { RolePanelShell } from '../../_shell/role-panel-shell';
import { AdminAccessScreen } from '@/features/roles/components/admin-access-screen';

// 통합 접근 화면(URL: /admin/access) — 접근: ADMIN만. 회원 공통 홈은
// `/dashboard`(세션 역할 ADMIN일 때 같은 스크린). 이 경로는 deep link·행 상세
// 모달 intercept 트리용으로 유지한다(PR04H). 기존 `/admin/users`·
// `/admin/staff-requests`는 리다이렉트 없이 404. 필터·정렬·페이지 상태는 URL
// searchParams(PR04D)라 `useSearchParams()`를 Suspense로 감싼다.
export default function AdminAccessPage() {
  return (
    <RolePanelShell allow={['ADMIN']}>
      <Suspense fallback={null}>
        <AdminAccessScreen />
      </Suspense>
    </RolePanelShell>
  );
}

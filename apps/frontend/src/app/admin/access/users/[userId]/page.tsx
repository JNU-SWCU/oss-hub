import { RolePanelShell } from '../../../../_shell/role-panel-shell';
import { ADMIN_MENU } from '../../../../_shell/role-menus';
import { AdminAccessDetailView } from '@/features/roles/components/admin-access-detail-view';

type AdminAccessDetailPageProps = {
  readonly params: Promise<{ readonly userId: string }>;
};

// 표준 접근 상세 화면(URL: /admin/access/users/[userId]) — 접근: ADMIN만
// (PR04E). 목록(`/admin/access`)에서 오버레이로 여는 것이 아니라, 이 경로로
// 직접 진입하거나 하드 새로고침해도 항상 이 화면이 마운트 시점에 상세와
// 요청/로그인 이력을 새로 불러온다. Sheet/Inspector 오버레이 내비게이션은
// PR04F의 몫이며, 이 라우트는 그 오버레이가 열릴 때도 여전히 단독 접근
// 가능한 canonical 주소로 남는다.
export default async function AdminAccessDetailPage({
  params,
}: AdminAccessDetailPageProps) {
  const { userId } = await params;
  let decodedUserId = userId;
  try {
    decodedUserId = decodeURIComponent(userId);
  } catch {
    decodedUserId = userId;
  }

  return (
    <RolePanelShell menu={ADMIN_MENU} allow={['ADMIN']}>
      <AdminAccessDetailView userId={decodedUserId} />
    </RolePanelShell>
  );
}

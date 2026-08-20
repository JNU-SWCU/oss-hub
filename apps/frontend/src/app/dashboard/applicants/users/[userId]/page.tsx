import { RolePanelShell } from '../../../../_shell/role-panel-shell';
import { AdminAccessDetailView } from '@/features/roles/components/admin-access-detail-view';

type ApplicantQueueDetailPageProps = {
  readonly params: Promise<{ readonly userId: string }>;
};

// 가입 신청 표준 상세(URL: /dashboard/applicants/users/[userId]) — 접근:
// STAFF·ADMIN. 대기 요청이 없는 id는 백엔드가 ROL_010(존재 누설 없음)으로
// 404를 낸다. 목록에서 오버레이로 여는 것이 아니라, 이 경로로 직접 진입하거나
// 하드 새로고침해도 항상 이 화면이 마운트 시점에 상세와 요청/로그인 이력을
// 새로 불러온다.
export default async function ApplicantQueueDetailPage({
  params,
}: ApplicantQueueDetailPageProps) {
  const { userId } = await params;
  let decodedUserId = userId;
  try {
    decodedUserId = decodeURIComponent(userId);
  } catch {
    decodedUserId = userId;
  }

  return (
    <RolePanelShell allow={['STAFF', 'ADMIN']}>
      <AdminAccessDetailView userId={decodedUserId} workspace="queue" />
    </RolePanelShell>
  );
}

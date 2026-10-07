import { RolePanelShell } from '../../../../_shell/role-panel-shell';
import { AdminAccessDetailView } from '@/features/roles/components/admin-access-detail-view';

type ApplicantQueueDetailPageProps = {
  readonly params: Promise<{ readonly userId: string }>;
};

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
    <RolePanelShell allow={['staff']}>
      <AdminAccessDetailView userId={decodedUserId} workspace="queue" />
    </RolePanelShell>
  );
}

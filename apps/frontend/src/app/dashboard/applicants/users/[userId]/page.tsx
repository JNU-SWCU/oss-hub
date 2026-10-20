import { RolePanelShell } from '../../../../_shell/role-panel-shell';
import { AdminAccessDetailScreen } from '@/features/roles/access-administration/components/admin-access-detail-screen';

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
      <AdminAccessDetailScreen userId={decodedUserId} workspace="queue" />
    </RolePanelShell>
  );
}

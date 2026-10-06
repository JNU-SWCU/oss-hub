import { RolePanelShell } from '../../../_shell/role-panel-shell';
import { AdminAccessDetailView } from '@/features/roles/components/admin-access-detail-view';

type AdminAccessDetailPageProps = {
  readonly params: Promise<{ readonly userId: string }>;
};

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
    <RolePanelShell allow={['admin']}>
      <AdminAccessDetailView userId={decodedUserId} workspace="directory" />
    </RolePanelShell>
  );
}

import { RolePanelShell } from '../../../_shell/role-panel-shell';
import { AdminAccessDetailScreen } from '@/features/roles/access-administration/components/admin-access-detail-screen';

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
      <AdminAccessDetailScreen userId={decodedUserId} workspace="directory" />
    </RolePanelShell>
  );
}

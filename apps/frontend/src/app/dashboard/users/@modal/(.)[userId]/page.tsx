import { AdminAccessOverlay } from '@/features/roles/components/admin-access-overlay';

type AdminAccessOverlayPageProps = {
  readonly params: Promise<{ readonly userId: string }>;
};

export default async function AdminAccessOverlayInterceptPage({
  params,
}: AdminAccessOverlayPageProps) {
  const { userId } = await params;
  let decodedUserId = userId;
  try {
    decodedUserId = decodeURIComponent(userId);
  } catch {
    decodedUserId = userId;
  }

  return <AdminAccessOverlay userId={decodedUserId} workspace="directory" />;
}

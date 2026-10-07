import { AdminAccessOverlay } from '@/features/roles/components/admin-access-overlay';

type ApplicantQueueOverlayPageProps = {
  readonly params: Promise<{ readonly userId: string }>;
};

export default async function ApplicantQueueOverlayInterceptPage({
  params,
}: ApplicantQueueOverlayPageProps) {
  const { userId } = await params;
  let decodedUserId = userId;
  try {
    decodedUserId = decodeURIComponent(userId);
  } catch {
    decodedUserId = userId;
  }

  return <AdminAccessOverlay userId={decodedUserId} workspace="queue" />;
}

import { AdminAccessOverlay } from '@/features/roles/components/admin-access-overlay';

type ApplicantQueueOverlayPageProps = {
  readonly params: Promise<{ readonly userId: string }>;
};

// 목록(`/dashboard/applicants`)에서 행을 소프트 클릭했을 때만 매칭되는
// intercepting route — `(.)users/[userId]`는 같은 세그먼트 레벨의
// `users/[userId]` 표준 상세를 가로챈다. URL은 표준 상세 주소
// (`/dashboard/applicants/users/[userId]`) 그대로 유지되고, 하드 새로고침·
// 직접 진입은 이 라우트를 절대 거치지 않는다.
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

import { AdminAccessOverlay } from '@/features/roles/components/admin-access-overlay';

type AdminAccessOverlayPageProps = {
  readonly params: Promise<{ readonly userId: string }>;
};

// 목록(`/admin/access`)에서 행을 소프트 클릭했을 때만 매칭되는 intercepting
// route(PR04F) — `(.)users/[userId]`는 같은 세그먼트 레벨(`app/admin/access/`)의
// `users/[userId]` 표준 상세를 가로챈다. URL은 표준 상세 주소
// (`/admin/access/users/[userId]`) 그대로 유지되고, 하드 새로고침·직접 진입은
// 이 라우트를 절대 거치지 않는다(그 경우 `@modal` 슬롯은 `default.tsx`가
// null을 반환하고, 표준 페이지(PR04E)가 그대로 렌더된다).
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

  return <AdminAccessOverlay userId={decodedUserId} />;
}

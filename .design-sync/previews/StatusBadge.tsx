// StatusBadge 프리뷰 — ProgramCard.tsx가 이미 program 도메인 문구(모집중/마감/대기/
// 승인/반려)로 5-variant를 다뤘으므로, 여기서는 features/roles/components/
// role-request-screen.tsx의 역할 요청 도메인 문구로 같은 축을 다시 전개해
// StatusBadge가 프로그램 카드 밖에서도 쓰이는 실제 사례를 보여준다.
import { StatusBadge } from 'frontend';

// role-request-screen.tsx의 statusPresentation()에 있는 4개 상태 그대로.
export function RoleRequestVariants() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusBadge variant="pending">승인 대기</StatusBadge>
      <StatusBadge variant="rejected">반려</StatusBadge>
      <StatusBadge variant="approved">승인</StatusBadge>
      <StatusBadge variant="closed">회수</StatusBadge>
    </div>
  );
}

// program-detail-page.tsx의 recruiting 축 — 5번째 variant까지 포함한 전체 전개.
export function AllVariants() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusBadge variant="recruiting">모집중</StatusBadge>
      <StatusBadge variant="closed">모집 마감</StatusBadge>
      <StatusBadge variant="pending">승인 대기</StatusBadge>
      <StatusBadge variant="approved">승인</StatusBadge>
      <StatusBadge variant="rejected">반려</StatusBadge>
    </div>
  );
}

// admin-users-view.tsx / archive-list-view.tsx의 영문 배지 텍스트 — 한글 배지와
// 같은 컴포넌트가 짧은 영문 라벨도 무리 없이 소화하는지 확인한다.
export function EnglishLabel() {
  return <StatusBadge variant="approved">GitHub PUBLIC</StatusBadge>;
}

// admin-users-view.tsx의 역할 미지정 표시 — rejected variant를 경고 용도로 재사용.
export function Unassigned() {
  return <StatusBadge variant="rejected">미지정</StatusBadge>;
}

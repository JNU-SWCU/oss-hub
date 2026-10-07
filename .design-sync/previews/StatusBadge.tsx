import { StatusBadge } from 'frontend';

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

export function EnglishLabel() {
  return <StatusBadge variant="approved">GitHub PUBLIC</StatusBadge>;
}

export function Unassigned() {
  return <StatusBadge variant="rejected">미지정</StatusBadge>;
}

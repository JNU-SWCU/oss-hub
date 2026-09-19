/**
 * `StatusBadge`의 variant 이름. lib은 최하위 계층이라 컴포넌트를 import하지 않고
 * 이름만 다시 적는다 — 어긋나면 배지에 넘기는 자리에서 타입 검사가 잡는다.
 */
export type StatusBadgeVariantName =
  'recruiting' | 'closed' | 'pending' | 'approved' | 'rejected';

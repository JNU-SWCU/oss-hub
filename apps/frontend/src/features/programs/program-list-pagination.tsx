import type { ReactElement } from 'react';
import { PaginationNav } from '@/components/pagination-nav';

interface ProgramListPaginationProps {
  readonly page: number;
  readonly totalPages: number;
  readonly onPageChange: (page: number) => void;
}

// 공용 `PaginationNav`(components/pagination-nav.tsx)의 얇은 래퍼 — 이 화면 고유의
// aria-label만 고정한다. 호출부(program-list-page 등)의 props·출력은 그대로다.
function ProgramListPagination(
  props: ProgramListPaginationProps,
): ReactElement | null {
  return <PaginationNav {...props} ariaLabel="프로그램 목록 페이지" />;
}

export { ProgramListPagination };

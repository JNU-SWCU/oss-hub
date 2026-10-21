import type { ReactElement } from 'react';
import { PaginationNav } from '@/components/pagination-nav';

interface ProgramListPaginationProps {
  readonly page: number;
  readonly totalPages: number;
  readonly onPageChange: (page: number) => void;
}

function ProgramListPagination(
  props: ProgramListPaginationProps,
): ReactElement | null {
  return <PaginationNav {...props} ariaLabel="프로그램 목록 페이지" />;
}

export { ProgramListPagination };

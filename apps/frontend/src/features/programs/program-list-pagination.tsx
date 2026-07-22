import type { ReactElement } from 'react';
import { Button } from '@/components/ui/button';

interface ProgramListPaginationProps {
  readonly page: number;
  readonly totalPages: number;
  readonly onPageChange: (page: number) => void;
}

function ProgramListPagination({
  page,
  totalPages,
  onPageChange,
}: ProgramListPaginationProps): ReactElement | null {
  if (totalPages <= 1) return null;

  return (
    <nav
      aria-label="프로그램 목록 페이지"
      className="flex items-center justify-center gap-3"
    >
      <Button
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        variant="outline"
      >
        이전
      </Button>
      <span className="text-sm text-muted-foreground">
        {page} / {totalPages}
      </span>
      <Button
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        variant="outline"
      >
        다음
      </Button>
    </nav>
  );
}

export { ProgramListPagination };

import type { ReactElement } from 'react';
import { Button } from '@/components/ui/button';

interface PaginationNavProps {
  readonly page: number;
  readonly totalPages: number;
  readonly onPageChange: (page: number) => void;

  readonly ariaLabel: string;
}

function PaginationNav({
  page,
  totalPages,
  onPageChange,
  ariaLabel,
}: PaginationNavProps): ReactElement | null {
  if (totalPages <= 1) return null;

  return (
    <nav
      aria-label={ariaLabel}
      className="flex items-center justify-center gap-4"
    >
      <Button
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        variant="outline"
      >
        이전
      </Button>
      <span className="text-small text-muted-foreground">
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

export { PaginationNav };

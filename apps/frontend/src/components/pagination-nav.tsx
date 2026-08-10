import type { ReactElement } from 'react';
import { Button } from '@/components/ui/button';

interface PaginationNavProps {
  readonly page: number;
  readonly totalPages: number;
  readonly onPageChange: (page: number) => void;
  /** 이 페이지네이션이 어느 목록을 넘기는지. 화면마다 다르므로 호출부가 준다. */
  readonly ariaLabel: string;
}

/**
 * 이전/다음 버튼 + `{page} / {totalPages}` 라벨의 공용 페이지네이션 UI.
 * `totalPages <= 1`이면 넘길 페이지가 없으므로 아무것도 렌더하지 않는다.
 * 원래 `programs/program-list-pagination.tsx`에 있던 관례를 그대로 승격한 것 —
 * 호출부(프로그램 목록, DataTable 등)가 각자의 `ariaLabel`만 넘긴다.
 */
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
export type { PaginationNavProps };

import * as React from 'react';

import { cn } from '@/lib/utils';
import { PaginationNav } from '@/components/pagination-nav';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface DataTableColumn<TRow> {
  id: string;
  header: React.ReactNode;
  cell: (row: TRow, rowIndex: number) => React.ReactNode;
  headClassName?: string;
  cellClassName?: string;
  /** 헤더 `<th>`에 그대로 전달되는 속성. 정렬 가능한 컬럼의 `aria-sort` 등에 쓴다. */
  headProps?: Pick<React.ComponentProps<'th'>, 'aria-sort'>;
}

interface DataTableProps<TRow> extends Omit<
  React.ComponentProps<'div'>,
  'children'
> {
  columns: DataTableColumn<TRow>[];
  data: TRow[];
  rowKey: (row: TRow, rowIndex: number) => React.Key;
  caption?: React.ReactNode;
  /**
   * 가로 스크롤 영역의 이름. 표가 넘칠 때 키보드 사용자가 초점을 옮겨 왔을 때
   * 무슨 표인지 들리게 한다. 화면마다 다르므로 호출부가 준다.
   */
  scrollRegionLabel?: string;
  isLoading?: boolean;
  loadingSlot?: React.ReactNode;
  emptyState?: React.ReactNode;
  /**
   * 주어지면 각 행 전체가 클릭 대상이 된다(마우스 보조 동선). 키보드 접근은
   * 여전히 셀 안의 기존 링크/버튼이 담당하므로 행 자체에는 `tabIndex`를
   * 주지 않는다.
   */
  onRowClick?: (row: TRow, rowIndex: number) => void;
  /**
   * 주어지면 표가 이 크기로 페이지를 나눈다(opt-in). 주지 않으면 지금처럼
   * `data`를 전량 렌더한다 — 기존 호출부 9곳의 동작은 이 prop이 없으면 100%
   * 그대로다. 페이지 상태는 이 컴포넌트가 들고 있다(호출부가 이미 서버
   * 페이지네이션을 하는 `programs` 화면과 달리, 여기 데이터는 이미 전량
   * 로드돼 있어 클라이언트에서 자르기만 하면 되기 때문).
   */
  pageSize?: number;
  /**
   * 페이지네이션 nav의 aria-label. `pageSize`를 줄 때만 쓰인다. 화면마다
   * 달라야 하므로 호출부가 준다(`scrollRegionLabel`과 같은 원칙).
   */
  paginationLabel?: string;
}

// 소비 화면이 컬럼·행 데이터를 주입하는 운영 데이터 테이블. 역할별 컬럼·액션 노출
// 분기는 이 컴포넌트가 아니라 호출부(소비 화면)가 columns 구성으로 결정한다.
function DataTable<TRow>({
  columns,
  data,
  rowKey,
  caption,
  scrollRegionLabel,
  isLoading = false,
  loadingSlot,
  emptyState,
  onRowClick,
  pageSize,
  paginationLabel,
  className,
  // 스크롤 안내는 **초점을 받는 요소**에 붙어야 읽힌다. 종전에는 호출부가 준
  // `aria-describedby` 가 바깥 래퍼에 실렸는데 그 래퍼는 초점을 못 받아,
  // 안내를 하고도 그대로 할 방법이 없었다.
  'aria-describedby': describedBy,
  ...props
}: DataTableProps<TRow>) {
  const colSpan = columns.length || 1;
  const [page, setPage] = React.useState(1);

  // `pageSize`가 없으면 totalPages는 항상 1 — nav는 그려지지 않고 아래
  // `pageRows`도 `data`와 같아진다(전량 렌더, 기존 동작 그대로).
  const totalPages = pageSize
    ? Math.max(1, Math.ceil(data.length / pageSize))
    : 1;
  // 데이터가 줄어 이전에 보던 페이지가 더는 없을 수 있다(예: 필터링) — state를
  // 따로 되돌리지 않고 렌더 시점에 범위 안으로 눌러 담는다.
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const pageRows = pageSize
    ? data.slice((currentPage - 1) * pageSize, currentPage * pageSize)
    : data;
  const pageStartIndex = pageSize ? (currentPage - 1) * pageSize : 0;

  return (
    <div
      data-slot="data-table"
      className={cn('min-w-0 w-full', className)}
      {...props}
    >
      <Table
        scrollRegionLabel={scrollRegionLabel}
        scrollRegionDescribedBy={describedBy}
      >
        {caption ? <TableCaption>{caption}</TableCaption> : null}
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead
                key={column.id}
                className={column.headClassName}
                {...column.headProps}
              >
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell
                colSpan={colSpan}
                className="h-24 text-center text-muted-foreground"
              >
                {loadingSlot ?? '불러오는 중…'}
              </TableCell>
            </TableRow>
          ) : data.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={colSpan}
                className="h-24 text-center text-muted-foreground"
              >
                {emptyState ?? '표시할 데이터가 없습니다.'}
              </TableCell>
            </TableRow>
          ) : (
            pageRows.map((row, localIndex) => {
              const rowIndex = pageStartIndex + localIndex;
              return (
                <TableRow
                  key={rowKey(row, rowIndex)}
                  className={
                    onRowClick
                      ? 'cursor-pointer hover:bg-muted/50 transition-colors'
                      : undefined
                  }
                  onClick={
                    onRowClick ? () => onRowClick(row, rowIndex) : undefined
                  }
                >
                  {columns.map((column) => (
                    <TableCell key={column.id} className={column.cellClassName}>
                      {column.cell(row, rowIndex)}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
      {pageSize ? (
        <div className="mt-4">
          <PaginationNav
            page={currentPage}
            totalPages={totalPages}
            onPageChange={setPage}
            ariaLabel={paginationLabel ?? '표 페이지'}
          />
        </div>
      ) : null}
    </div>
  );
}

export { DataTable };
export type { DataTableColumn, DataTableProps };

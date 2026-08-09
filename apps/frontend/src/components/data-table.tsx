import * as React from 'react';

import { cn } from '@/lib/utils';
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
  className,
  // 스크롤 안내는 **초점을 받는 요소**에 붙어야 읽힌다. 종전에는 호출부가 준
  // `aria-describedby` 가 바깥 래퍼에 실렸는데 그 래퍼는 초점을 못 받아,
  // 안내를 하고도 그대로 할 방법이 없었다.
  'aria-describedby': describedBy,
  ...props
}: DataTableProps<TRow>) {
  const colSpan = columns.length || 1;

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
            data.map((row, rowIndex) => (
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
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export { DataTable };
export type { DataTableColumn, DataTableProps };

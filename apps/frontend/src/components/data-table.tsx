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

  headProps?: Pick<React.ComponentProps<'th'>, 'aria-sort'>;

  rowHeader?: boolean;
}

interface DataTableProps<TRow> extends Omit<
  React.ComponentProps<'div'>,
  'children'
> {
  columns: DataTableColumn<TRow>[];
  data: TRow[];
  rowKey: (row: TRow, rowIndex: number) => React.Key;
  caption?: React.ReactNode;

  hideCaption?: boolean;

  scrollRegionLabel?: string;
  isLoading?: boolean;
  loadingSlot?: React.ReactNode;
  emptyState?: React.ReactNode;

  onRowClick?: (row: TRow, rowIndex: number) => void;

  isRowClickable?: (row: TRow, rowIndex: number) => boolean;

  pageSize?: number;

  paginationLabel?: string;
}

function DataTable<TRow>({
  columns,
  data,
  rowKey,
  caption,
  hideCaption = false,
  scrollRegionLabel,
  isLoading = false,
  loadingSlot,
  emptyState,
  onRowClick,
  isRowClickable,
  pageSize,
  paginationLabel,
  className,

  'aria-describedby': describedBy,
  ...props
}: DataTableProps<TRow>) {
  const colSpan = columns.length || 1;
  const [page, setPage] = React.useState(1);

  const totalPages = pageSize
    ? Math.max(1, Math.ceil(data.length / pageSize))
    : 1;

  const currentPage = Math.min(Math.max(page, 1), totalPages);
  React.useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);
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
        {caption ? (
          <TableCaption className={hideCaption ? 'sr-only' : undefined}>
            {caption}
          </TableCaption>
        ) : null}
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
              const handleRowClick = onRowClick;
              const clickable =
                handleRowClick !== undefined &&
                (isRowClickable ? isRowClickable(row, rowIndex) : true);
              return (
                <TableRow
                  key={rowKey(row, rowIndex)}
                  className={clickable ? 'cursor-pointer' : undefined}
                  onClick={
                    clickable && handleRowClick
                      ? (event: React.MouseEvent<HTMLTableRowElement>) => {
                          const selection = window.getSelection();
                          if (selection !== null && !selection.isCollapsed)
                            return;

                          const target = event.target;
                          if (
                            target instanceof Element &&
                            target.closest('a, button')
                          )
                            return;
                          handleRowClick(row, rowIndex);
                        }
                      : undefined
                  }
                >
                  {columns.map((column) =>
                    column.rowHeader ? (
                      <TableHead
                        key={column.id}
                        scope="row"
                        className={column.cellClassName}
                      >
                        {column.cell(row, rowIndex)}
                      </TableHead>
                    ) : (
                      <TableCell
                        key={column.id}
                        className={column.cellClassName}
                      >
                        {column.cell(row, rowIndex)}
                      </TableCell>
                    ),
                  )}
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
export type { DataTableColumn };

import * as React from "react"

import { cn } from "@/lib/utils"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

interface DataTableColumn<TRow> {
  id: string
  header: React.ReactNode
  cell: (row: TRow, rowIndex: number) => React.ReactNode
  headClassName?: string
  cellClassName?: string
}

interface DataTableProps<TRow> extends Omit<React.ComponentProps<"div">, "children"> {
  columns: DataTableColumn<TRow>[]
  data: TRow[]
  rowKey: (row: TRow, rowIndex: number) => React.Key
  caption?: React.ReactNode
  isLoading?: boolean
  loadingSlot?: React.ReactNode
  emptyState?: React.ReactNode
}

// 소비 화면이 컬럼·행 데이터를 주입하는 운영 데이터 테이블. 역할별 컬럼·액션 노출
// 분기는 이 컴포넌트가 아니라 호출부(소비 화면)가 columns 구성으로 결정한다.
function DataTable<TRow>({
  columns,
  data,
  rowKey,
  caption,
  isLoading = false,
  loadingSlot,
  emptyState,
  className,
  ...props
}: DataTableProps<TRow>) {
  const colSpan = columns.length || 1

  return (
    <div data-slot="data-table" className={cn("w-full", className)} {...props}>
      <Table>
        {caption ? <TableCaption>{caption}</TableCaption> : null}
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column.id} className={column.headClassName}>
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
                {loadingSlot ?? "불러오는 중…"}
              </TableCell>
            </TableRow>
          ) : data.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={colSpan}
                className="h-24 text-center text-muted-foreground"
              >
                {emptyState ?? "표시할 데이터가 없습니다."}
              </TableCell>
            </TableRow>
          ) : (
            data.map((row, rowIndex) => (
              <TableRow key={rowKey(row, rowIndex)}>
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
  )
}

export { DataTable }
export type { DataTableColumn, DataTableProps }

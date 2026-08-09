'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

interface TableProps extends React.ComponentProps<'table'> {
  /**
   * 가로 스크롤 영역의 이름. 주면 그 영역이 `role="region"` 으로 이름을 갖는다.
   * 이름 없는 region 은 화면 읽기 도구에 "영역" 이라고만 들려 없느니만 못하므로
   * 이름이 있을 때만 붙인다.
   */
  readonly scrollRegionLabel?: string;
  /** 스크롤 안내 문구의 id. 초점을 **받는** 요소에 붙어야 읽힌다. */
  readonly scrollRegionDescribedBy?: string;
}

/**
 * 가로로 넘치는 표는 스크롤 영역이 **키보드로 도달 가능**해야 한다(WCAG 2.1.1).
 * 종전에는 이 컨테이너에 `tabIndex` 가 없어 마우스·터치로만 숨은 열을 볼 수 있었다.
 * 더 나빴던 것은 화면들이 「표를 좌우로 스크롤할 수 있습니다」 안내를 스크린리더에
 * 붙여 놓고 **그렇게 할 방법을 주지 않았다**는 점이다(QA14·QA15).
 *
 * `tabIndex` 는 이름 유무와 무관하게 붙인다 — 스크롤 가능성은 이름이 아니라 내용이
 * 정하고, 이름이 있을 때만 초점을 주면 이름을 빠뜨린 새 표가 조용히 접근 불가로
 * 돌아간다. 원래 결함이 정확히 그런 식으로 생겼다.
 */
function Table({
  className,
  scrollRegionLabel,
  scrollRegionDescribedBy,
  ...props
}: TableProps) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
      tabIndex={0}
      role={scrollRegionLabel === undefined ? undefined : 'region'}
      aria-label={scrollRegionLabel}
      aria-describedby={scrollRegionDescribedBy}
    >
      <table
        data-slot="table"
        className={cn('w-full caption-bottom text-sm', className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return (
    <thead
      data-slot="table-header"
      // 시안 v2 — 진한 선은 머리글 아래 한 줄뿐이다. 행 사이는 아래 TableBody가
      // 옅게 긋는다. 표에 격자를 다 그리면 값보다 선이 먼저 읽힌다.
      className={cn('[&_tr]:border-b [&_tr]:border-border', className)}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn(
        // 행 높이 `--row-height`(76) · 행 사이는 옅은 선. 마지막 행은 긋지 않는다
        // (카드 테두리와 겹쳐 이중선이 된다).
        '[&>tr]:h-row [&>tr]:border-border/50 [&_tr:last-child]:border-0',
        className,
      )}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        'border-t bg-muted/50 font-medium [&>tr]:last:border-b-0',
        className,
      )}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted',
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'px-6 py-4 text-left align-middle text-xs font-semibold tracking-wide whitespace-nowrap text-muted-foreground [&:has([role=checkbox])]:pr-0',
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        'px-6 py-4 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0',
        className,
      )}
      {...props}
    />
  );
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<'caption'>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn('mt-4 text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
};

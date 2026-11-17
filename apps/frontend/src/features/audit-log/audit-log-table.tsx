'use client';

import { useState, type ReactElement } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { DataTable, type DataTableColumn } from '@/components';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  actionLabel,
  actorLabel,
  formatDate,
  formatTime,
  roleLabel,
  targetLabel,
} from './audit-log-format';
import {
  AuditLogActionValue,
  AuditLogActor,
  AuditLogChangeValue,
  AuditLogRole,
  AuditLogTargetValue,
} from './audit-log-parts';
import type { AuditLogRecord } from './types';

export type AuditLogSortKey =
  'occurredAt' | 'actor' | 'role' | 'action' | 'target';

export interface AuditLogSort {
  readonly key: AuditLogSortKey;
  readonly direction: 'asc' | 'desc';
}

const SORT_LABELS: Readonly<Record<AuditLogSortKey, string>> = {
  occurredAt: '시각',
  actor: '행위자',
  role: '역할',
  action: '동작',
  target: '대상',
};

function sortValue(record: AuditLogRecord, key: AuditLogSortKey): string {
  switch (key) {
    case 'occurredAt':
      return record.occurredAt;
    case 'actor':
      return actorLabel(record).primary;
    case 'role':
      return roleLabel(record.actor?.role ?? null) ?? '';
    case 'action':
      return actionLabel(record);
    case 'target':
      return targetLabel(record)?.primary ?? '';
  }
}

export function sortAuditLogRecords(
  records: readonly AuditLogRecord[],
  sort: AuditLogSort,
): readonly AuditLogRecord[] {
  const sign = sort.direction === 'asc' ? 1 : -1;
  return [...records].sort(
    (left, right) =>
      sign *
      sortValue(left, sort.key).localeCompare(sortValue(right, sort.key), 'ko'),
  );
}

const WIDE_ONLY = 'hidden sm:table-cell';

function sortableColumn(
  key: AuditLogSortKey,
  sort: AuditLogSort,
  onSort: (key: AuditLogSortKey) => void,
  cell: DataTableColumn<AuditLogRecord>['cell'],
  visibility = '',
): DataTableColumn<AuditLogRecord> {
  const active = sort.key === key;
  const Icon = active && sort.direction === 'asc' ? ChevronUp : ChevronDown;
  return {
    id: key,
    header: (
      <Button
        type="button"
        variant="bare"
        size="content"
        className="inline-flex items-center gap-0.5 whitespace-nowrap hover:text-foreground"
        onClick={() => onSort(key)}
      >
        {SORT_LABELS[key]}
        <Icon
          aria-hidden="true"
          className={active ? 'size-3.5' : 'size-3.5 opacity-40'}
        />
      </Button>
    ),
    headProps: {
      'aria-sort': active
        ? sort.direction === 'asc'
          ? 'ascending'
          : 'descending'
        : 'none',
    },
    headClassName: cn('whitespace-nowrap', visibility),
    cellClassName: cn(
      'align-top whitespace-normal sm:whitespace-nowrap',
      visibility,
    ),
    cell,
  };
}

export function AuditLogTable({
  records,
}: {
  readonly records: readonly AuditLogRecord[];
}): ReactElement {
  const [sort, setSort] = useState<AuditLogSort>({
    key: 'occurredAt',
    direction: 'desc',
  });
  const onSort = (key: AuditLogSortKey) =>
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: key === 'occurredAt' ? 'desc' : 'asc' },
    );
  const columns: DataTableColumn<AuditLogRecord>[] = [
    sortableColumn('occurredAt', sort, onSort, (record) => (
      <time
        dateTime={record.occurredAt}
        className="flex flex-col whitespace-nowrap tabular-nums sm:block"
      >
        <span>{formatDate(record.occurredAt)}</span>{' '}
        <span>{formatTime(record.occurredAt)}</span>
      </time>
    )),
    sortableColumn('actor', sort, onSort, (record) => (
      <div className="flex min-w-0 flex-col gap-1">
        <AuditLogActor record={record} />
        <div
          data-slot="audit-row-detail"
          className="flex min-w-0 flex-col gap-0.5 text-xs leading-relaxed break-keep [overflow-wrap:anywhere] sm:hidden"
        >
          <span className="flex flex-wrap items-baseline gap-x-1">
            <AuditLogRole record={record} />
            <AuditLogActionValue record={record} />
          </span>
          <AuditLogTargetValue record={record} />
          <AuditLogChangeValue record={record} />
        </div>
      </div>
    )),
    sortableColumn(
      'role',
      sort,
      onSort,
      (record) => <AuditLogRole record={record} />,
      WIDE_ONLY,
    ),
    sortableColumn(
      'action',
      sort,
      onSort,
      (record) => <AuditLogActionValue record={record} />,
      WIDE_ONLY,
    ),
    sortableColumn(
      'target',
      sort,
      onSort,
      (record) => <AuditLogTargetValue record={record} />,
      WIDE_ONLY,
    ),
    {
      id: 'change',
      header: '변경',
      headClassName: WIDE_ONLY,
      cellClassName: cn('align-top', WIDE_ONLY),
      cell: (record) => <AuditLogChangeValue record={record} />,
    },
  ];
  return (
    <DataTable
      className="min-w-0 rounded-lg border border-border"
      scrollRegionLabel="감사 로그 표"
      columns={columns}
      data={[...sortAuditLogRecords(records, sort)]}
      rowKey={(record) => record.id}
    />
  );
}

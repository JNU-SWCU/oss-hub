'use client';

import type { ReactElement } from 'react';
import { DataTable, type DataTableColumn } from '@/components';
import { Button } from '@/components/ui/button';
import { formatDateTime, resultLabel, targetLabel } from './audit-log-format';
import {
  AuditLogActionValue,
  AuditLogActor,
  AuditLogChangeValue,
  AuditLogRole,
  AuditLogTargetValue,
} from './audit-log-parts';
import type { AuditLogRecord } from './types';

const CELL_CLASS = 'px-4 py-2 align-baseline';

const WRAP_CELL_CLASS = `${CELL_CLASS} whitespace-normal`;

export function AuditLogTable({
  records,
  now,
  selectedId,
  onSelect,
}: {
  readonly records: readonly AuditLogRecord[];
  readonly now: Date;
  readonly selectedId: string | null;
  readonly onSelect: (id: string | null) => void;
}): ReactElement {
  const toggle = (record: AuditLogRecord) =>
    onSelect(record.id === selectedId ? null : record.id);
  const columns: DataTableColumn<AuditLogRecord>[] = [
    {
      id: 'occurredAt',
      header: '시각',
      headClassName: CELL_CLASS,
      cellClassName: `${CELL_CLASS} tabular-nums`,
      cell: (record) => (
        <time dateTime={record.occurredAt}>
          {formatDateTime(record.occurredAt, now)}
        </time>
      ),
    },
    {
      id: 'actor',
      header: '행위자',
      headClassName: CELL_CLASS,
      cellClassName: CELL_CLASS,
      cell: (record) => (
        <span className="inline-flex items-baseline gap-x-1.5">
          <AuditLogActor record={record} />
          <AuditLogRole record={record} />
        </span>
      ),
    },
    {
      id: 'action',
      header: '작업',
      headClassName: CELL_CLASS,
      cellClassName: CELL_CLASS,
      cell: (record) => (
        <Button
          type="button"
          variant="bare"
          size="content"
          aria-pressed={record.id === selectedId}
          className="text-left aria-pressed:font-semibold"
          onClick={() => toggle(record)}
        >
          <AuditLogActionValue record={record} />
        </Button>
      ),
    },
    {
      id: 'target',
      header: '대상',
      headClassName: CELL_CLASS,
      cellClassName: WRAP_CELL_CLASS,
      cell: (record) =>
        targetLabel(record) === null ? (
          <span aria-hidden="true" className="text-muted-foreground">
            —
          </span>
        ) : (
          <AuditLogTargetValue record={record} />
        ),
    },
    {
      id: 'result',
      header: '결과',
      headClassName: CELL_CLASS,
      cellClassName: WRAP_CELL_CLASS,
      cell: (record) =>
        record.mailDelivery ? (
          <AuditLogChangeValue record={record} />
        ) : (
          resultLabel(record)
        ),
    },
  ];
  return (
    <DataTable
      className="min-w-0 overflow-hidden rounded-card ring-1 ring-foreground/10"
      scrollRegionLabel="감사 로그 표"
      columns={columns}
      data={[...records]}
      rowKey={(record) => record.id}
      onRowClick={toggle}
    />
  );
}

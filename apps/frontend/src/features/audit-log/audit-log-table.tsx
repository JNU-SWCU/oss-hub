'use client';

import type { ReactElement } from 'react';
import { DataTable, type DataTableColumn } from '@/components';
import { Button } from '@/components/ui/button';
import type { AuditFeedEvent } from './audit-log-fold';
import { formatDateTime, resultLabel, targetLabel } from './audit-log-format';
import {
  AuditLogActionValue,
  AuditLogActor,
  AuditLogChangeValue,
  AuditLogRole,
  AuditLogTargetValue,
} from './audit-log-parts';

const CELL_CLASS = 'px-4 py-2 align-baseline';

const WRAP_CELL_CLASS = `${CELL_CLASS} whitespace-normal`;

export function AuditLogTable({
  events,
  now,
  selectedId,
  onSelect,
}: {
  readonly events: readonly AuditFeedEvent[];
  readonly now: Date;
  readonly selectedId: string | null;
  readonly onSelect: (key: string | null) => void;
}): ReactElement {
  const toggle = ({ key }: AuditFeedEvent) => {
    onSelect(key === selectedId ? null : key);
  };
  const columns: DataTableColumn<AuditFeedEvent>[] = [
    {
      id: 'occurredAt',
      header: '시각',
      headClassName: CELL_CLASS,
      cellClassName: `${CELL_CLASS} tabular-nums`,
      cell: ({ record }) => (
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
      cell: ({ record }) => (
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
      cell: (event) => (
        <Button
          type="button"
          variant="bare"
          size="content"
          aria-pressed={event.key === selectedId}
          className="text-left aria-pressed:font-semibold"
          onClick={() => toggle(event)}
        >
          <AuditLogActionValue record={event.record} />
        </Button>
      ),
    },
    {
      id: 'target',
      header: '대상',
      headClassName: CELL_CLASS,
      cellClassName: WRAP_CELL_CLASS,
      cell: ({ record }) =>
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
      cell: ({ record }) =>
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
      data={[...events]}
      rowKey={(event) => event.key}
      onRowClick={toggle}
    />
  );
}

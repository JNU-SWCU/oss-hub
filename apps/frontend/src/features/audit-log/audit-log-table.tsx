'use client';

import type { ReactElement } from 'react';
import { DataTable, type DataTableColumn } from '@/components';
import type { AuditFeedEvent } from './audit-log-fold';
import {
  changeLines,
  formatDateTime,
  formatFullDateTime,
  resultLabel,
  targetLabel,
} from './audit-log-format';
import {
  AuditLogActionValue,
  AuditLogActorSearch,
  AuditLogChange,
  AuditLogRole,
  AuditLogTargetValue,
} from './audit-log-parts';

const CELL_CLASS = 'px-4 py-2 align-baseline';

const WRAP_CELL_CLASS = `${CELL_CLASS} whitespace-normal`;

export function AuditLogTable({
  events,
  now,
  onSearchPerson,
}: {
  readonly events: readonly AuditFeedEvent[];
  readonly now: Date;
  readonly onSearchPerson: (login: string) => void;
}): ReactElement {
  const columns: DataTableColumn<AuditFeedEvent>[] = [
    {
      id: 'occurredAt',
      header: '시각',
      headClassName: CELL_CLASS,
      cellClassName: `${CELL_CLASS} tabular-nums`,
      cell: ({ record }) => (
        <time
          dateTime={record.occurredAt}
          title={
            record.requestId
              ? `${formatFullDateTime(record.occurredAt)} · 요청 ${record.requestId}`
              : undefined
          }
        >
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
          <AuditLogActorSearch
            record={record}
            onSearchPerson={onSearchPerson}
          />
          <AuditLogRole record={record} />
        </span>
      ),
    },
    {
      id: 'action',
      header: '작업',
      headClassName: CELL_CLASS,
      cellClassName: CELL_CLASS,
      cell: ({ record }) => <AuditLogActionValue record={record} />,
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
      id: 'change',
      header: '변경',
      headClassName: CELL_CLASS,
      cellClassName: WRAP_CELL_CLASS,
      cell: ({ record }) => (
        <span className="flex flex-col gap-0.5">
          {changeLines(record).map((line) => (
            <AuditLogChange key={line.field ?? ''} label={line} />
          ))}
        </span>
      ),
    },
    {
      id: 'result',
      header: '결과',
      headClassName: CELL_CLASS,
      cellClassName: CELL_CLASS,
      cell: ({ record }) => resultLabel(record),
    },
  ];
  return (
    <DataTable
      className="min-w-0 overflow-hidden rounded-card ring-1 ring-foreground/10"
      scrollRegionLabel="감사 로그 표"
      columns={columns}
      data={[...events]}
      rowKey={(event) => event.key}
    />
  );
}

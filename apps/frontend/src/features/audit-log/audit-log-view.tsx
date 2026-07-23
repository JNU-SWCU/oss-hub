import type { FormEvent } from 'react';
import {
  DataTable,
  EmptyState,
  PageHeader,
  type DataTableColumn,
} from '@/components';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { AuditLogFilters, AuditLogRecord } from './types';

const ACTIONS = [
  { value: 'STAFF_ROLE_REQUEST_APPROVED', label: '승인' },
  { value: 'STAFF_ROLE_REQUEST_REJECTED', label: '반려' },
  { value: 'STAFF_ROLE_REQUEST_REVOKED', label: '회수' },
] as const;

export interface AuditLogViewProps {
  readonly records: readonly AuditLogRecord[];
  readonly filters: AuditLogFilters;
  readonly isLoading: boolean;
  readonly errorMessage: string | null;
  readonly onFilterChange: (filters: AuditLogFilters) => void;
  readonly onSearch: () => void;
  readonly onReset: () => void;
  readonly onRetry: () => void;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function AuditLogView(props: AuditLogViewProps) {
  const columns: DataTableColumn<AuditLogRecord>[] = [
    {
      id: 'actor',
      header: '행위자',
      headClassName: 'min-w-32 whitespace-nowrap',
      cellClassName: 'min-w-32 whitespace-nowrap',
      cell: (record) => <span className="font-medium">{record.actor}</span>,
    },
    {
      id: 'action',
      header: '액션',
      headClassName: 'min-w-64 whitespace-nowrap',
      cellClassName: 'min-w-64 whitespace-nowrap',
      cell: (record) => (
        <span className="break-keep font-mono text-xs">{record.action}</span>
      ),
    },
    {
      id: 'target',
      header: '대상',
      headClassName: 'min-w-48 whitespace-nowrap',
      cellClassName: 'min-w-48 whitespace-nowrap',
      cell: (record) => (
        <span className="break-keep">
          {record.targetType} / {record.targetId}
        </span>
      ),
    },
    {
      id: 'occurredAt',
      header: '발생 일시',
      headClassName: 'min-w-40 whitespace-nowrap',
      cellClassName: 'min-w-40 whitespace-nowrap',
      cell: (record) => (
        <time dateTime={record.occurredAt}>
          {formatDate(record.occurredAt)}
        </time>
      ),
    },
  ];

  const update = (key: keyof AuditLogFilters, value: string) =>
    props.onFilterChange({ ...props.filters, [key]: value });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    props.onSearch();
  };

  return (
    <section className="flex min-w-0 flex-col gap-6 p-4 sm:p-6">
      <PageHeader
        title="감사 로그"
        description={
          <span className="break-keep">
            역할 요청 변경 이력을 행위자, 액션, 기간으로 조회합니다.
          </span>
        }
      />
      <form
        className="grid w-full min-w-0 gap-4 rounded-lg border border-border p-4 sm:grid-cols-2 xl:grid-cols-5 xl:items-end"
        onSubmit={submit}
      >
        <div className="flex w-full min-w-0 flex-col gap-2">
          <label htmlFor="audit-actor" className="text-sm font-medium">
            행위자
          </label>
          <Input
            id="audit-actor"
            className="min-h-11 w-full min-w-0"
            value={props.filters.actor}
            onChange={(event) => update('actor', event.target.value)}
            placeholder="GitHub 아이디"
          />
        </div>
        <div className="flex w-full min-w-0 flex-col gap-2">
          <label htmlFor="audit-action" className="text-sm font-medium">
            액션 종류
          </label>
          <select
            id="audit-action"
            className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 min-h-11 w-full min-w-0 rounded-md border px-3 text-sm outline-none focus-visible:ring-[3px]"
            value={props.filters.action}
            onChange={(event) => update('action', event.target.value)}
          >
            <option value="">전체</option>
            {ACTIONS.map((action) => (
              <option key={action.value} value={action.value}>
                {action.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex w-full min-w-0 flex-col gap-2">
          <label htmlFor="audit-from" className="text-sm font-medium">
            시작일
          </label>
          <Input
            id="audit-from"
            className="min-h-11 w-full min-w-0"
            type="date"
            value={props.filters.from}
            onChange={(event) => update('from', event.target.value)}
          />
        </div>
        <div className="flex w-full min-w-0 flex-col gap-2">
          <label htmlFor="audit-to" className="text-sm font-medium">
            종료일
          </label>
          <Input
            id="audit-to"
            className="min-h-11 w-full min-w-0"
            type="date"
            value={props.filters.to}
            onChange={(event) => update('to', event.target.value)}
          />
        </div>
        <div className="flex w-full min-w-0 gap-2">
          <Button type="submit" className="min-h-11 min-w-0 flex-1">
            조회
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 min-w-0 flex-1"
            onClick={props.onReset}
          >
            초기화
          </Button>
        </div>
      </form>
      {props.errorMessage ? (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{props.errorMessage}</span>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={props.onRetry}
            >
              다시 시도
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      <p id="audit-table-scroll-hint" className="text-muted-foreground text-sm">
        표를 좌우로 스크롤할 수 있습니다.
      </p>
      <DataTable
        className="min-w-0 rounded-lg border border-border"
        aria-describedby="audit-table-scroll-hint"
        columns={columns}
        data={[...props.records]}
        rowKey={(record) => record.id}
        isLoading={props.isLoading}
        loadingSlot={
          <div
            className="flex flex-col gap-2 py-2"
            aria-busy="true"
            aria-label="감사 로그를 불러오는 중"
          >
            {[0, 1, 2].map((row) => (
              <span
                key={row}
                className="bg-muted mx-auto h-3 w-4/5 animate-pulse rounded"
              />
            ))}
          </div>
        }
        emptyState={
          <EmptyState
            title="기록이 없습니다"
            description="조회 조건을 바꿔 보세요."
          />
        }
      />
    </section>
  );
}

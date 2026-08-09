import type { FormEvent } from 'react';
import {
  DataTable,
  EmptyState,
  PageHeader,
  StatusBadge,
  type DataTableColumn,
} from '@/components';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AUDIT_LOG_ACTION_LABELS,
  AUDIT_LOG_ACTIONS,
  type AuditLogFilters,
  type AuditLogRecord,
} from './types';
import { resolveAuditLogActionBadge } from './audit-log-action';
import { AuditLogSentence } from './audit-log-sentence';
import { describeAuditLog, describeTargetType } from './describe';

export interface AuditLogViewProps {
  readonly records: readonly AuditLogRecord[];
  readonly filters: AuditLogFilters;
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly isLoading: boolean;
  readonly errorMessage: string | null;
  readonly onFilterChange: (filters: AuditLogFilters) => void;
  readonly onSearch: () => void;
  readonly onReset: () => void;
  readonly onPageChange: (page: number) => void;
  readonly onRetry: () => void;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

// 큰 단위부터 순서대로 훑어, 경과 시간이 그 단위의 임계값을 넘는 첫 단위로 표시한다
// (예: 90분 경과 → hour 임계값 3600초를 넘으므로 "1시간 전"). 1분 미만은 RelativeTimeFormat이
// "0분 전" 같은 어색한 값을 낼 수 있어 "방금 전"으로 따로 처리한다.
const RELATIVE_TIME_UNITS: readonly (readonly [
  Intl.RelativeTimeFormatUnit,
  number,
])[] = [
  ['year', 60 * 60 * 24 * 365],
  ['month', 60 * 60 * 24 * 30],
  ['week', 60 * 60 * 24 * 7],
  ['day', 60 * 60 * 24],
  ['hour', 60 * 60],
  ['minute', 60],
];

const relativeTimeFormatter = new Intl.RelativeTimeFormat('ko', {
  numeric: 'auto',
});

function formatRelativeTime(value: string, now: Date): string {
  const diffSeconds = Math.round(
    (new Date(value).getTime() - now.getTime()) / 1000,
  );
  if (Math.abs(diffSeconds) < 60) return '방금 전';
  for (const [unit, secondsInUnit] of RELATIVE_TIME_UNITS) {
    if (Math.abs(diffSeconds) >= secondsInUnit) {
      return relativeTimeFormatter.format(
        Math.trunc(diffSeconds / secondsInUnit),
        unit,
      );
    }
  }
  return relativeTimeFormatter.format(Math.trunc(diffSeconds / 60), 'minute');
}

export function AuditLogView(props: AuditLogViewProps) {
  const lastPage = Math.max(1, Math.ceil(props.total / props.limit));
  // 행마다 새 Date를 만들면 렌더 한 번 안에서도 상대 시각 기준이 미묘하게 어긋날 수
  // 있어 렌더당 한 번만 고정한다.
  const now = new Date();
  const columns: DataTableColumn<AuditLogRecord>[] = [
    {
      id: 'occurredAt',
      header: '발생 일시',
      headClassName: 'min-w-32 whitespace-nowrap',
      cellClassName: 'min-w-32 align-top whitespace-nowrap',
      cell: (record) => (
        <time dateTime={record.occurredAt} className="flex flex-col text-sm">
          <span>{formatRelativeTime(record.occurredAt, now)}</span>
          <span className="text-muted-foreground text-xs">
            {formatDate(record.occurredAt)}
          </span>
        </time>
      ),
    },
    {
      id: 'content',
      header: '내용',
      headClassName: 'min-w-64',
      cellClassName: 'min-w-64 align-top',
      cell: (record) => {
        const { sentence } = describeAuditLog(record);
        const { label, variant } = resolveAuditLogActionBadge(record.action);
        return (
          <div className="flex flex-col gap-1.5 py-0.5">
            <p className="text-sm leading-relaxed break-keep">
              <AuditLogSentence segments={sentence} />
            </p>
            <p className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
              <StatusBadge variant={variant} className="h-5 px-2 text-[11px]">
                {label}
              </StatusBadge>
              <span>{describeTargetType(record.targetType)}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-xs">{record.targetId}</span>
            </p>
          </div>
        );
      },
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
            {AUDIT_LOG_ACTIONS.map((action) => (
              <option key={action} value={action}>
                {AUDIT_LOG_ACTION_LABELS[action]}
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
      <DataTable
        className="min-w-0 rounded-lg border border-border"
        scrollRegionLabel="감사 로그 표"
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
      <div className="flex items-center justify-end gap-3 text-sm">
        <span>총 {props.total}건</span>
        <span>
          {props.page} / {lastPage} 페이지
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={props.page <= 1 || props.isLoading}
          onClick={() => props.onPageChange(props.page - 1)}
        >
          이전
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={props.page >= lastPage || props.isLoading}
          onClick={() => props.onPageChange(props.page + 1)}
        >
          다음
        </Button>
      </div>
    </section>
  );
}

import type { FormEvent } from 'react';
import { DataTable, EmptyState, PageHeader } from '@/components';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AUDIT_LOG_ACTION_LABELS,
  AUDIT_LOG_ACTIONS,
  type AuditLogFilters,
  type AuditLogRecord,
} from './types';
import { createAuditLogColumns } from './audit-log-columns';

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

export function AuditLogView(props: AuditLogViewProps) {
  const lastPage = Math.max(1, Math.ceil(props.total / props.limit));
  // 행마다 새 Date를 만들면 렌더 한 번 안에서도 상대 시각 기준이 미묘하게 어긋날 수
  // 있어 렌더당 한 번만 고정한다.
  const columns = createAuditLogColumns(new Date());

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
            역할·계정 변경, 프로그램 보관·복구, 수집 실행, 신청 승인·반려 등
            관리 작업 이력을 행위자, 액션, 기간으로 조회합니다.
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

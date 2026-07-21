import type { FormEvent } from 'react';

import {
  DataTable,
  EmptyState,
  PageHeader,
  RowActions,
  StatusBadge,
  type DataTableColumn,
} from '@/components';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import type { StaffRoleRequest, StaffRoleRequestStatus } from '../types';
import { StaffRequestRejectDialog } from './staff-request-reject-dialog';
import { StaffRequestRevokeDialog } from './staff-request-revoke-dialog';

const STATUS_TABS: readonly {
  readonly value: StaffRoleRequestStatus;
  readonly label: string;
}[] = [
  { value: 'PENDING', label: '대기' },
  { value: 'APPROVED', label: '승인' },
  { value: 'REJECTED', label: '반려' },
  { value: 'REVOKED', label: '회수' },
];

const STATUS_PRESENTATION = {
  PENDING: { label: '대기', variant: 'pending' },
  APPROVED: { label: '승인', variant: 'approved' },
  REJECTED: { label: '반려', variant: 'rejected' },
  REVOKED: { label: '회수', variant: 'closed' },
} as const;

export interface StaffRequestsViewProps {
  readonly items: readonly StaffRoleRequest[];
  readonly status: StaffRoleRequestStatus;
  readonly query: string;
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly isLoading: boolean;
  readonly errorMessage: string | null;
  readonly successMessage?: string | null;
  readonly processingIds: ReadonlySet<string>;
  readonly rejectingRequest: StaffRoleRequest | null;
  readonly revokingRequest: StaffRoleRequest | null;
  readonly rejectionReason: string;
  readonly onStatusChange: (status: StaffRoleRequestStatus) => void;
  readonly onQueryChange: (query: string) => void;
  readonly onSearch: () => void;
  readonly onPageChange: (page: number) => void;
  readonly onApprove: (request: StaffRoleRequest) => void;
  readonly onOpenReject: (request: StaffRoleRequest) => void;
  readonly onCloseReject: () => void;
  readonly onRejectionReasonChange: (reason: string) => void;
  readonly onConfirmReject: () => void;
  readonly onOpenRevoke: (request: StaffRoleRequest) => void;
  readonly onCloseRevoke: () => void;
  readonly onConfirmRevoke: () => void;
  readonly onRetry: () => void;
  readonly onResetFilters?: () => void;
}

function formatDate(value: string | null): string {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function StaffRequestsView(props: StaffRequestsViewProps) {
  const lastPage = Math.max(1, Math.ceil(props.total / props.limit));
  const columns: DataTableColumn<StaffRoleRequest>[] = [
    {
      id: 'requester',
      header: '요청자',
      cell: (request) => (
        <a
          href={`https://github.com/${request.githubLogin}`}
          target="_blank"
          rel="noreferrer"
          className="font-medium underline-offset-4 hover:underline"
        >
          {request.githubLogin}
        </a>
      ),
    },
    {
      id: 'requestedAt',
      header: '요청 시각',
      cell: (request) => formatDate(request.requestedAt),
    },
    {
      id: 'status',
      header: '상태',
      cell: (request) => {
        const presentation = STATUS_PRESENTATION[request.status];
        return (
          <StatusBadge variant={presentation.variant}>
            {presentation.label}
          </StatusBadge>
        );
      },
    },
    {
      id: 'decision',
      header: '처리 정보',
      cell: (request) => (
        <div className="flex min-w-40 flex-col gap-1 text-sm">
          <span>{request.decidedBy ?? '-'}</span>
          <span className="text-muted-foreground">
            {formatDate(request.decidedAt)}
          </span>
          {request.rejectionReason ? (
            <span className="text-muted-foreground">
              {request.rejectionReason}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      id: 'actions',
      header: <span className="sr-only">작업</span>,
      headClassName: 'text-right',
      cell: (request) => {
        if (request.status === 'PENDING') {
          return (
            <RowActions>
              <Button
                size="sm"
                onClick={() => props.onApprove(request)}
                disabled={props.processingIds.has(request.id)}
              >
                승인
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => props.onOpenReject(request)}
                disabled={props.processingIds.has(request.id)}
              >
                반려
              </Button>
            </RowActions>
          );
        }
        if (request.status === 'APPROVED') {
          return (
            <RowActions>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => props.onOpenRevoke(request)}
                disabled={props.processingIds.has(request.id)}
              >
                회수
              </Button>
            </RowActions>
          );
        }
        return null;
      },
    },
  ];

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    props.onSearch();
  };

  return (
    <section className="flex flex-col gap-6 p-6">
      <PageHeader
        title="교직원 승인 관리"
        description="교직원 역할 요청을 승인·반려하고 승인된 역할을 회수합니다."
      />
      {props.errorMessage ? (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{props.errorMessage}</span>
            <Button size="sm" variant="outline" onClick={props.onRetry}>
              다시 시도
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {props.successMessage ? (
        <Alert>
          <AlertDescription>{props.successMessage}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-wrap gap-2" aria-label="요청 상태">
          {STATUS_TABS.map((tab) => (
            <Button
              key={tab.value}
              size="sm"
              variant={props.status === tab.value ? 'default' : 'outline'}
              aria-pressed={props.status === tab.value}
              onClick={() => props.onStatusChange(tab.value)}
            >
              {tab.label}
            </Button>
          ))}
        </div>
        <form className="flex w-full gap-2 sm:max-w-sm" onSubmit={submitSearch}>
          <Input
            aria-label="GitHub 아이디 검색"
            placeholder="GitHub 아이디 검색"
            value={props.query}
            onChange={(event) => props.onQueryChange(event.target.value)}
          />
          <Button type="submit" variant="outline">
            검색
          </Button>
        </form>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <DataTable
          columns={columns}
          data={[...props.items]}
          rowKey={(request) => request.id}
          isLoading={props.isLoading}
          loadingSlot="요청 목록을 불러오는 중…"
          emptyState={
            <EmptyState
              title={
                props.status === 'PENDING'
                  ? '승인 대기 중인 요청이 없습니다'
                  : '조건에 맞는 요청이 없습니다'
              }
              action={
                <Button
                  variant="outline"
                  onClick={props.onResetFilters ?? props.onRetry}
                >
                  필터 초기화
                </Button>
              }
            />
          }
        />
      </div>
      <div className="flex items-center justify-end gap-3 text-sm">
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
      {props.rejectingRequest ? (
        <StaffRequestRejectDialog
          request={props.rejectingRequest}
          reason={props.rejectionReason}
          isProcessing={props.processingIds.has(props.rejectingRequest.id)}
          onReasonChange={props.onRejectionReasonChange}
          onCancel={props.onCloseReject}
          onConfirm={props.onConfirmReject}
        />
      ) : null}
      {props.revokingRequest ? (
        <StaffRequestRevokeDialog
          request={props.revokingRequest}
          isProcessing={props.processingIds.has(props.revokingRequest.id)}
          onCancel={props.onCloseRevoke}
          onConfirm={props.onConfirmRevoke}
        />
      ) : null}
    </section>
  );
}

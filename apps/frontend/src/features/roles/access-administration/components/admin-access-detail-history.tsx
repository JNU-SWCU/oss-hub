import type { ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import { StatusBadge } from '@/components';
import { PaginationNav } from '@/components/pagination-nav';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type {
  AdminAccessHistory,
  AdminAccessLoginHistoryItem,
  AdminAccessStaffAccessRequestHistoryItem,
} from '../admin-access-api';
import {
  adminAccessHistoryPageCount,
  formatAdminAccessDateTime,
  formatAdminAccessRelativeTime,
} from '../admin-access-detail-api';
import type { DetailHeadingTag } from './admin-access-detail-layout';

const ROLE_REQUEST_STATUS: Record<
  AdminAccessStaffAccessRequestHistoryItem['status'],
  {
    readonly label: string;
    readonly variant: 'pending' | 'approved' | 'rejected' | 'closed';
  }
> = {
  PENDING: { label: '대기', variant: 'pending' },
  APPROVED: { label: '승인', variant: 'approved' },
  REJECTED: { label: '반려', variant: 'rejected' },
  REVOKED: { label: '회수', variant: 'closed' },
};

export interface AdminAccessHistoryError {
  readonly message: string;
  readonly onRetry: () => void;
}

function HistoryEntry({
  at,
  now,
  badge,
  children,
}: {
  readonly at: string;
  readonly now: Date;
  readonly badge: ReactNode;
  readonly children?: ReactNode;
}) {
  return (
    <li className="grid gap-1 py-3 text-sm first:pt-0 last:pb-0 @md:grid-cols-[9rem_minmax(0,1fr)] @md:gap-x-4">
      <span className="grid content-start gap-0.5">
        <time dateTime={at} className="font-medium tabular-nums">
          {formatAdminAccessRelativeTime(at, now)}
        </time>
        <span className="text-small text-muted-foreground tabular-nums">
          {formatAdminAccessDateTime(at)}
        </span>
      </span>
      <span className="grid min-w-0 content-start gap-1">
        <span className="flex flex-wrap items-center gap-2">{badge}</span>
        {children}
      </span>
    </li>
  );
}

function HistoryGroup({
  id,
  title,
  headingTag: HeadingTag,
  emptyText,
  isEmpty,
  page,
  totalPages,
  isLoading,
  onPageChange,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly headingTag: 'h3' | 'h4';
  readonly emptyText: string;
  readonly isEmpty: boolean;
  readonly page: number;
  readonly totalPages: number;
  readonly isLoading: boolean;
  readonly onPageChange: (page: number) => void;
  readonly children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="grid gap-2">
      <HeadingTag
        id={id}
        className="text-small font-bold text-muted-foreground"
      >
        {title}
      </HeadingTag>
      {isEmpty ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-border/50">{children}</ul>
      )}
      <PaginationNav
        page={page}
        totalPages={totalPages}
        isLoading={isLoading}
        onPageChange={onPageChange}
        ariaLabel={`${title} 이력 페이지`}
      />
    </section>
  );
}

function StaffAccessRequestEntry({
  request,
  now,
}: {
  readonly request: AdminAccessStaffAccessRequestHistoryItem;
  readonly now: Date;
}) {
  const status = ROLE_REQUEST_STATUS[request.status];
  return (
    <HistoryEntry
      at={request.createdAt}
      now={now}
      badge={<StatusBadge variant={status.variant}>{status.label}</StatusBadge>}
    >
      {request.decidedAt ? (
        <span className="text-muted-foreground">
          처리 {formatAdminAccessDateTime(request.decidedAt)}
          {request.decidedBy ? ` · ${request.decidedBy}` : ''}
        </span>
      ) : null}
      {request.rejectionReason ? (
        <span className="break-words">
          반려 사유: {request.rejectionReason}
        </span>
      ) : null}
    </HistoryEntry>
  );
}

function LoginEntry({
  event,
  now,
}: {
  readonly event: AdminAccessLoginHistoryItem;
  readonly now: Date;
}) {
  return (
    <HistoryEntry
      at={event.loginAt}
      now={now}
      badge={
        <StatusBadge variant={event.success ? 'approved' : 'rejected'}>
          {event.event === 'LOGIN' ? '로그인' : '로그아웃'}
          {event.success ? '' : ' 실패'}
        </StatusBadge>
      }
    />
  );
}

export function AdminAccessHistoryCard({
  history,
  headingTag: HeadingTag,
  isLoading,
  error,
  onStaffAccessRequestPageChange,
  onLoginHistoryPageChange,
}: {
  readonly history: AdminAccessHistory;
  readonly headingTag: DetailHeadingTag;
  readonly isLoading: boolean;
  readonly error: AdminAccessHistoryError | null;
  readonly onStaffAccessRequestPageChange: (page: number) => void;
  readonly onLoginHistoryPageChange: (page: number) => void;
}) {
  const now = new Date();
  const groupHeadingTag = HeadingTag === 'h2' ? 'h3' : 'h4';
  const { staffAccessRequests, loginHistory } = history;

  return (
    <Card size="sm" className="@container">
      <CardHeader>
        <CardTitle>
          <HeadingTag>이력</HeadingTag>
        </CardTitle>
      </CardHeader>
      {error ? (
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertTitle>이력 조회 실패</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>{error.message}</p>
              <Button
                variant="outline"
                onClick={error.onRetry}
                disabled={isLoading}
              >
                다시 시도
              </Button>
            </AlertDescription>
          </Alert>
        </CardContent>
      ) : null}
      <CardContent>
        <HistoryGroup
          id="admin-access-role-request-history"
          title="교직원 권한 요청"
          headingTag={groupHeadingTag}
          emptyText="교직원 권한 요청 이력이 없습니다."
          isEmpty={staffAccessRequests.items.length === 0}
          page={staffAccessRequests.page}
          totalPages={adminAccessHistoryPageCount(staffAccessRequests)}
          isLoading={isLoading}
          onPageChange={onStaffAccessRequestPageChange}
        >
          {staffAccessRequests.items.map((request) => (
            <StaffAccessRequestEntry
              key={request.id}
              request={request}
              now={now}
            />
          ))}
        </HistoryGroup>
      </CardContent>
      <CardContent className="border-t border-border pt-(--card-spacing)">
        <HistoryGroup
          id="admin-access-login-history"
          title="로그인"
          headingTag={groupHeadingTag}
          emptyText="로그인 이력이 없습니다."
          isEmpty={loginHistory.items.length === 0}
          page={loginHistory.page}
          totalPages={adminAccessHistoryPageCount(loginHistory)}
          isLoading={isLoading}
          onPageChange={onLoginHistoryPageChange}
        >
          {loginHistory.items.map((event) => (
            <LoginEntry key={event.id} event={event} now={now} />
          ))}
        </HistoryGroup>
      </CardContent>
    </Card>
  );
}

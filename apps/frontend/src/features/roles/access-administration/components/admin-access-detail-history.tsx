import { StatusBadge } from '@/components';
import { Button } from '@/components/ui/button';
import { CardTitle } from '@/components/ui/card';
import type {
  AdminAccessLoginHistoryItem,
  AdminAccessStaffAccessRequestHistoryItem,
} from '../admin-access-api';
import { formatAdminAccessDateTime } from '../admin-access-detail-api';
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

function HistoryPaginationControls({
  page,
  totalPages,
  isLoading,
  onPageChange,
}: {
  readonly page: number;
  readonly totalPages: number;
  readonly isLoading: boolean;
  readonly onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1 && page <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-3 text-sm">
      <span>
        {page} / {totalPages} 페이지
      </span>
      <Button
        size="sm"
        variant="outline"
        disabled={page <= 1 || isLoading}
        onClick={() => onPageChange(page - 1)}
      >
        이전
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={page >= totalPages || isLoading}
        onClick={() => onPageChange(page + 1)}
      >
        다음
      </Button>
    </div>
  );
}

interface HistorySectionProps {
  readonly page: number;
  readonly totalPages: number;
  readonly isLoading: boolean;
  readonly onPageChange: (page: number) => void;
  readonly headingTag: DetailHeadingTag;
}

export function StaffAccessRequestHistorySection({
  items,
  page,
  totalPages,
  isLoading,
  onPageChange,
  headingTag: HeadingTag,
}: HistorySectionProps & {
  readonly items: readonly AdminAccessStaffAccessRequestHistoryItem[];
}) {
  return (
    <section
      aria-labelledby="admin-access-role-request-history"
      className="grid gap-3"
    >
      <CardTitle>
        <HeadingTag id="admin-access-role-request-history">
          요청 이력
        </HeadingTag>
      </CardTitle>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          역할 요청 이력이 없습니다.
        </p>
      ) : (
        <ul className="divide-y divide-border/50">
          {items.map((request) => {
            const status = ROLE_REQUEST_STATUS[request.status];
            return (
              <li
                key={request.id}
                className="grid gap-1 py-2 text-sm first:pt-0 last:pb-0"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge variant={status.variant}>
                    {status.label}
                  </StatusBadge>
                  <span className="text-muted-foreground">
                    신청 {formatAdminAccessDateTime(request.createdAt)}
                  </span>
                </div>
                {request.decidedAt ? (
                  <span className="text-muted-foreground">
                    처리 {formatAdminAccessDateTime(request.decidedAt)}
                    {request.decidedBy ? ` · ${request.decidedBy}` : ''}
                  </span>
                ) : null}
                {request.rejectionReason ? (
                  <span>반려 사유: {request.rejectionReason}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <HistoryPaginationControls
        page={page}
        totalPages={totalPages}
        isLoading={isLoading}
        onPageChange={onPageChange}
      />
    </section>
  );
}

export function LoginHistorySection({
  items,
  page,
  totalPages,
  isLoading,
  onPageChange,
  headingTag: HeadingTag,
}: HistorySectionProps & {
  readonly items: readonly AdminAccessLoginHistoryItem[];
}) {
  return (
    <section
      aria-labelledby="admin-access-login-history"
      className="grid gap-3"
    >
      <CardTitle>
        <HeadingTag id="admin-access-login-history">로그인 이력</HeadingTag>
      </CardTitle>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">로그인 이력이 없습니다.</p>
      ) : (
        <ul className="divide-y divide-border/50">
          {items.map((event) => (
            <li
              key={event.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm first:pt-0 last:pb-0"
            >
              <StatusBadge variant={event.success ? 'approved' : 'rejected'}>
                {event.event === 'LOGIN' ? '로그인' : '로그아웃'}
                {event.success ? '' : ' 실패'}
              </StatusBadge>
              <span className="text-muted-foreground tabular-nums">
                {formatAdminAccessDateTime(event.loginAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <HistoryPaginationControls
        page={page}
        totalPages={totalPages}
        isLoading={isLoading}
        onPageChange={onPageChange}
      />
    </section>
  );
}

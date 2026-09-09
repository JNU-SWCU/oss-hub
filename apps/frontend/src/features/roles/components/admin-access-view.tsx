import { EmptyState, PageHeader } from '@/components';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

import type {
  AdminAccessAccountStatus,
  AdminAccessListItem,
  AdminAccessPendingFilter,
  AdminAccessRoleFilter,
  AdminAccessSortDirection,
  AdminAccessSortField,
} from '../admin-access-api';
import type { AccessWorkspace } from '../admin-access-list-query';
import { AdminAccessFilters } from './admin-access-filters';
import { AdminAccessTable } from './admin-access-table';

export interface AdminAccessViewProps {
  readonly workspace: AccessWorkspace;
  readonly items: readonly AdminAccessListItem[];
  readonly query: string;
  readonly role: AdminAccessRoleFilter | '';
  readonly accountStatus: AdminAccessAccountStatus | '';
  readonly pendingRequest: AdminAccessPendingFilter | '';
  readonly sort: AdminAccessSortField;
  readonly direction: AdminAccessSortDirection;
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly pendingCount: number;
  readonly isLoading: boolean;
  readonly errorMessage: string | null;
  readonly onQueryChange: (query: string) => void;
  readonly onSearch: () => void;
  readonly onRoleChange: (role: AdminAccessRoleFilter | '') => void;
  readonly onAccountStatusChange: (
    status: AdminAccessAccountStatus | '',
  ) => void;
  readonly onPendingRequestChange: (
    pendingRequest: AdminAccessPendingFilter | '',
  ) => void;
  readonly onSortToggle: (field: AdminAccessSortField) => void;
  readonly onPageChange: (page: number) => void;
  readonly onRetry: () => void;
  readonly onResetFilters: () => void;
  readonly onRowClick: (item: AdminAccessListItem) => void;
}

export function AdminAccessView(props: AdminAccessViewProps) {
  const lastPage = Math.max(1, Math.ceil(props.total / props.limit));
  const isQueue = props.workspace === 'queue';
  const hasActiveFilters =
    props.query.trim() !== '' ||
    (!isQueue && (props.role !== '' || props.accountStatus !== ''));
  const isEmptyInbox = isQueue && props.items.length === 0 && !hasActiveFilters;

  return (
    <section className="flex flex-col gap-6 p-4 sm:p-6">
      <PageHeader
        title={isQueue ? '가입 신청' : '사용자 목록'}
        description={
          isQueue
            ? '교직원 역할 신청을 승인하거나 반려합니다.'
            : '역할·계정 상태·마지막 로그인을 조회하고 변경합니다.'
        }
      />
      {props.errorMessage ? (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{props.errorMessage}</span>
            <Button className="h-11" variant="outline" onClick={props.onRetry}>
              다시 시도
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      <AdminAccessFilters
        isQueue={isQueue}
        query={props.query}
        role={props.role}
        accountStatus={props.accountStatus}
        onQueryChange={props.onQueryChange}
        onSearch={props.onSearch}
        onRoleChange={props.onRoleChange}
        onAccountStatusChange={props.onAccountStatusChange}
      />
      <AdminAccessTable
        workspace={props.workspace}
        items={props.items}
        sort={props.sort}
        direction={props.direction}
        isLoading={props.isLoading}
        emptyState={
          isEmptyInbox ? (
            <EmptyState title="승인 대기 중인 요청이 없습니다" />
          ) : (
            <EmptyState
              title="검색 결과가 없습니다"
              action={
                <Button
                  className="h-11"
                  variant="outline"
                  onClick={props.onResetFilters}
                >
                  필터 초기화
                </Button>
              }
            />
          )
        }
        onSortToggle={props.onSortToggle}
        onRowClick={props.onRowClick}
      />
      <div className="flex items-center justify-end gap-3 text-sm">
        <span>
          {props.page} / {lastPage} 페이지 (총 {props.total}명)
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

import type { SubmitEvent } from 'react';
import Link from 'next/link';

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

import type {
  AdminAccessAccountStatus,
  AdminAccessListItem,
  AdminAccessPendingFilter,
  AdminAccessRole,
  AdminAccessRoleFilter,
  AdminAccessSortDirection,
  AdminAccessSortField,
} from '../admin-access-api';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './role-select';

const ROLE_FILTER_LABEL: Record<AdminAccessRoleFilter, string> = {
  UNASSIGNED: '미지정',
  STUDENT: '학생',
  STAFF: '교직원',
  ADMIN: '관리자',
};

const ACCOUNT_STATUS_LABEL: Record<AdminAccessAccountStatus, string> = {
  ACTIVE: '활성',
  DEACTIVATED: '비활성',
};

const PENDING_FILTER_LABEL: Record<AdminAccessPendingFilter, string> = {
  NONE: '요청 없음',
  PENDING: '대기 중',
};

const SORT_FIELD_LABEL: Record<AdminAccessSortField, string> = {
  name: '이름',
  createdAt: '가입일',
  lastLoginAt: '마지막 로그인',
};

const ALL_ROLES = 'ALL_ROLES';
const ALL_ACCOUNT_STATUSES = 'ALL_ACCOUNT_STATUSES';
const ALL_PENDING = 'ALL_PENDING';

export interface AdminAccessViewProps {
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
  readonly onSortChange: (sort: AdminAccessSortField) => void;
  readonly onDirectionToggle: () => void;
  readonly onPageChange: (page: number) => void;
  readonly onRetry: () => void;
  readonly onResetFilters: () => void;
}

function formatLastLoginAt(value: string | null): string {
  if (!value) return '기록 없음';
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function RoleBadge({ role }: { readonly role: AdminAccessRole | null }) {
  if (!role) {
    return <StatusBadge variant="rejected">미지정</StatusBadge>;
  }
  return (
    <StatusBadge
      variant={
        role === 'ADMIN' ? 'approved' : role === 'STAFF' ? 'pending' : 'closed'
      }
    >
      {ROLE_FILTER_LABEL[role]}
    </StatusBadge>
  );
}

function AccountStatusBadge({
  status,
}: {
  readonly status: AdminAccessAccountStatus;
}) {
  return (
    <StatusBadge variant={status === 'ACTIVE' ? 'approved' : 'closed'}>
      {ACCOUNT_STATUS_LABEL[status]}
    </StatusBadge>
  );
}

export function AdminAccessView(props: AdminAccessViewProps) {
  const lastPage = Math.max(1, Math.ceil(props.total / props.limit));

  const columns: DataTableColumn<AdminAccessListItem>[] = [
    {
      id: 'user',
      header: '사용자',
      cellClassName: 'whitespace-normal',
      cell: (item) => (
        <div className="flex min-w-0 flex-col gap-2 lg:min-w-48 lg:gap-1">
          <Link
            href={`/admin/access/users/${encodeURIComponent(item.id)}`}
            className="line-clamp-2 break-all font-medium underline-offset-2 hover:underline"
          >
            {item.name ?? '이름 미등록'}
          </Link>
          <span className="text-muted-foreground">@{item.githubLogin}</span>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {item.isProfileComplete ? null : (
              <StatusBadge variant="rejected">프로필 미완료</StatusBadge>
            )}
            {item.pendingRequest ? (
              <StatusBadge variant="pending">요청 대기</StatusBadge>
            ) : null}
            <div className="flex flex-wrap items-center gap-2 lg:hidden">
              <RoleBadge role={item.role} />
              <AccountStatusBadge status={item.accountStatus} />
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'role',
      header: '역할',
      headClassName: 'hidden lg:table-cell',
      cellClassName: 'hidden lg:table-cell',
      cell: (item) => <RoleBadge role={item.role} />,
    },
    {
      id: 'accountStatus',
      header: '계정 상태',
      headClassName: 'hidden lg:table-cell',
      cellClassName: 'hidden lg:table-cell',
      cell: (item) => <AccountStatusBadge status={item.accountStatus} />,
    },
    {
      id: 'lastLoginAt',
      header: '마지막 로그인',
      headClassName: 'hidden lg:table-cell',
      cellClassName: 'hidden lg:table-cell text-muted-foreground',
      cell: (item) => formatLastLoginAt(item.lastLoginAt),
    },
  ];

  const submitSearch = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    props.onSearch();
  };

  return (
    <section className="flex flex-col gap-6 p-4 sm:p-6">
      <PageHeader
        title="접근 목록"
        description="통합 접근 화면에서 사용자 역할·계정 상태·승인 대기 요청을 조회합니다."
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
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label="접근 화면 전환"
      >
        <Button
          className="h-11"
          type="button"
          variant={props.pendingRequest === '' ? 'default' : 'outline'}
          aria-pressed={props.pendingRequest === ''}
          onClick={() => props.onPendingRequestChange('')}
        >
          전체 목록
        </Button>
        <Button
          className="h-11"
          type="button"
          variant={props.pendingRequest === 'PENDING' ? 'default' : 'outline'}
          aria-pressed={props.pendingRequest === 'PENDING'}
          onClick={() => props.onPendingRequestChange('PENDING')}
        >
          요청함{props.pendingCount > 0 ? ` (${props.pendingCount})` : ''}
        </Button>
      </div>
      <form
        className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_9rem_9rem_9rem_9rem_auto_auto]"
        onSubmit={submitSearch}
      >
        <Input
          className="h-11"
          aria-label="이름 또는 GitHub 닉네임 검색"
          placeholder="이름 또는 GitHub 닉네임"
          value={props.query}
          onChange={(event) => props.onQueryChange(event.target.value)}
        />
        <label className="sr-only" htmlFor="admin-access-role-filter">
          역할 필터
        </label>
        <Select
          value={props.role || ALL_ROLES}
          onValueChange={(role) =>
            props.onRoleChange(
              role === ALL_ROLES ? '' : (role as AdminAccessRoleFilter),
            )
          }
        >
          <SelectTrigger id="admin-access-role-filter" className="h-11">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_ROLES}>전체 역할</SelectItem>
            {Object.entries(ROLE_FILTER_LABEL).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="sr-only" htmlFor="admin-access-status-filter">
          계정 상태 필터
        </label>
        <Select
          value={props.accountStatus || ALL_ACCOUNT_STATUSES}
          onValueChange={(status) =>
            props.onAccountStatusChange(
              status === ALL_ACCOUNT_STATUSES
                ? ''
                : (status as AdminAccessAccountStatus),
            )
          }
        >
          <SelectTrigger id="admin-access-status-filter" className="h-11">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_ACCOUNT_STATUSES}>전체 상태</SelectItem>
            {Object.entries(ACCOUNT_STATUS_LABEL).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="sr-only" htmlFor="admin-access-pending-filter">
          요청 대기 필터
        </label>
        <Select
          value={props.pendingRequest || ALL_PENDING}
          onValueChange={(pendingRequest) =>
            props.onPendingRequestChange(
              pendingRequest === ALL_PENDING
                ? ''
                : (pendingRequest as AdminAccessPendingFilter),
            )
          }
        >
          <SelectTrigger id="admin-access-pending-filter" className="h-11">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_PENDING}>전체 요청</SelectItem>
            {Object.entries(PENDING_FILTER_LABEL).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="sr-only" htmlFor="admin-access-sort-field">
          정렬 기준
        </label>
        <Select
          value={props.sort}
          onValueChange={(sort) =>
            props.onSortChange(sort as AdminAccessSortField)
          }
        >
          <SelectTrigger id="admin-access-sort-field" className="h-11">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(SORT_FIELD_LABEL).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          className="h-11"
          type="button"
          variant="outline"
          aria-label={
            props.direction === 'asc' ? '오름차순 정렬됨' : '내림차순 정렬됨'
          }
          onClick={props.onDirectionToggle}
        >
          {props.direction === 'asc' ? '오름차순' : '내림차순'}
        </Button>
        <Button className="h-11" type="submit" variant="outline">
          검색
        </Button>
      </form>
      <div className="overflow-x-auto rounded-lg border border-border">
        <DataTable
          columns={columns}
          data={[...props.items]}
          rowKey={(item) => item.id}
          isLoading={props.isLoading}
          loadingSlot="접근 목록을 불러오는 중…"
          emptyState={
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
          }
        />
      </div>
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

import type { SubmitEvent } from 'react';
import Link from 'next/link';
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ExternalLink,
} from 'lucide-react';

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

const ALL_ROLES = 'ALL_ROLES';
const ALL_ACCOUNT_STATUSES = 'ALL_ACCOUNT_STATUSES';

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
  readonly onSortToggle: (field: AdminAccessSortField) => void;
  readonly onPageChange: (page: number) => void;
  readonly onRetry: () => void;
  readonly onResetFilters: () => void;
  readonly onRowClick: (item: AdminAccessListItem) => void;
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

function sortAriaValue(
  active: boolean,
  direction: AdminAccessSortDirection,
): 'ascending' | 'descending' | undefined {
  if (!active) return undefined;
  return direction === 'asc' ? 'ascending' : 'descending';
}

function SortableColumnHeader({
  label,
  field,
  sort,
  direction,
  onSortToggle,
}: {
  readonly label: string;
  readonly field: AdminAccessSortField;
  readonly sort: AdminAccessSortField;
  readonly direction: AdminAccessSortDirection;
  readonly onSortToggle: (field: AdminAccessSortField) => void;
}) {
  const active = sort === field;
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 hover:text-foreground"
      onClick={() => onSortToggle(field)}
    >
      {label}
      {active ? (
        direction === 'asc' ? (
          <ChevronUp aria-hidden="true" className="size-4" />
        ) : (
          <ChevronDown aria-hidden="true" className="size-4" />
        )
      ) : null}
    </button>
  );
}

export function AdminAccessView(props: AdminAccessViewProps) {
  const lastPage = Math.max(1, Math.ceil(props.total / props.limit));

  const columns: DataTableColumn<AdminAccessListItem>[] = [
    {
      id: 'user',
      header: (
        <SortableColumnHeader
          label="사용자"
          field="name"
          sort={props.sort}
          direction={props.direction}
          onSortToggle={props.onSortToggle}
        />
      ),
      headProps: {
        'aria-sort': sortAriaValue(props.sort === 'name', props.direction),
      },
      cellClassName: 'whitespace-normal',
      cell: (item) => (
        <div className="flex min-w-0 flex-col gap-2 lg:min-w-48 lg:gap-1">
          <Link
            href={`/admin/access/users/${encodeURIComponent(item.id)}`}
            className="line-clamp-2 break-all font-medium underline-offset-2 hover:underline"
            // 오버레이(PR04F)로 열리는 소프트 내비게이션이라 목록 스크롤 위치를
            // 유지해야 한다 — next/link 기본값(scroll=true)은 네비게이션마다
            // 스크롤을 맨 위로 리셋해, 오버레이가 닫힐 때 원래 위치로 복원할
            // 기준점 자체를 잃어버리게 만든다(실측: scrollY 캡처가 항상 0이 됨).
            scroll={false}
          >
            {item.name ?? '이름 미등록'}
          </Link>
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">
              @{item.githubLogin}
            </span>
            <a
              href={`https://github.com/${item.githubLogin}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub 프로필 열기"
              className="text-muted-foreground hover:text-foreground focus-visible:text-foreground"
              onClick={(event) => event.stopPropagation()}
            >
              <ExternalLink aria-hidden="true" className="size-4" />
            </a>
          </div>
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
      header: (
        <SortableColumnHeader
          label="마지막 로그인"
          field="lastLoginAt"
          sort={props.sort}
          direction={props.direction}
          onSortToggle={props.onSortToggle}
        />
      ),
      headProps: {
        'aria-sort': sortAriaValue(
          props.sort === 'lastLoginAt',
          props.direction,
        ),
      },
      headClassName: 'hidden lg:table-cell',
      cellClassName: 'hidden lg:table-cell text-muted-foreground',
      cell: (item) => formatLastLoginAt(item.lastLoginAt),
    },
    {
      id: 'chevron',
      header: <span className="sr-only">상세</span>,
      headClassName: 'w-8',
      cellClassName: 'w-8 text-right',
      cell: () => (
        <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
      ),
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
        className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_9rem_9rem_auto]"
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
        <Button className="h-11" type="submit" variant="outline">
          검색
        </Button>
      </form>
      {/* 가로 스크롤은 표 안쪽 컨테이너(초점을 받는 쪽) 하나만 담당한다. 여기서도
          `overflow-x-auto` 를 주면 스크롤 영역이 두 겹이 되어, 키보드 초점은 안쪽에
          있는데 바깥이 따로 밀리는 상태가 된다. 이 래퍼는 `rounded-lg` 모서리를
          클립하는 역할만 남긴다. */}
      <div className="overflow-hidden rounded-lg border border-border">
        <DataTable
          scrollRegionLabel="사용자 접근 목록 표"
          columns={columns}
          data={[...props.items]}
          rowKey={(item) => item.id}
          onRowClick={(item) => props.onRowClick(item)}
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

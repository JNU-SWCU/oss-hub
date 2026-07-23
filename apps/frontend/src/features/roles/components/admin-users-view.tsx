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

import type { AdminUser, UserRole } from '../types';
import { AdminRoleChangeDialog } from './admin-role-change-dialog';

const ROLE_LABEL: Record<UserRole, string> = {
  STUDENT: '학생',
  STAFF: '교직원',
  ADMIN: '관리자',
};

export interface RoleChangeConfirmation {
  readonly user: AdminUser;
  readonly role: UserRole;
}

interface AdminUsersViewProps {
  readonly items: readonly AdminUser[];
  readonly query: string;
  readonly role: UserRole | '';
  readonly isLoading: boolean;
  readonly errorMessage: string | null;
  readonly successMessage: string | null;
  readonly processingId: string | null;
  readonly confirmation: RoleChangeConfirmation | null;
  readonly onQueryChange: (query: string) => void;
  readonly onRoleChange: (role: UserRole | '') => void;
  readonly onSearch: () => void;
  readonly onRequestRoleChange: (user: AdminUser, role: UserRole) => void;
  readonly onCancelConfirmation: () => void;
  readonly onConfirmRoleChange: () => void;
  readonly onRetry: () => void;
  readonly onResetFilters: () => void;
}

export function AdminUsersView(props: AdminUsersViewProps) {
  const columns: DataTableColumn<AdminUser>[] = [
    {
      id: 'user',
      header: '사용자',
      cellClassName: 'whitespace-normal break-keep',
      cell: (user) => (
        <div className="flex min-w-40 flex-col gap-0.5">
          <span className="font-medium">{user.name ?? '이름 미등록'}</span>
          <span className="text-muted-foreground">@{user.githubLogin}</span>
        </div>
      ),
    },
    {
      id: 'role',
      header: '현재 역할',
      cell: (user) =>
        user.role ? (
          <StatusBadge
            variant={
              user.role === 'ADMIN'
                ? 'approved'
                : user.role === 'STAFF'
                  ? 'pending'
                  : 'closed'
            }
          >
            {ROLE_LABEL[user.role]}
          </StatusBadge>
        ) : (
          <StatusBadge variant="rejected">미지정</StatusBadge>
        ),
    },
    {
      id: 'accountStatus',
      header: '계정 상태',
      cell: (user) => (
        <StatusBadge
          variant={user.accountStatus === 'ACTIVE' ? 'approved' : 'closed'}
        >
          {user.accountStatus === 'ACTIVE' ? '활성' : '비활성'}
        </StatusBadge>
      ),
    },
    {
      id: 'actions',
      header: <span className="sr-only">역할 변경</span>,
      headClassName: 'text-right',
      cell: (user) => (
        <RowActions>
          <label className="sr-only" htmlFor={`role-${user.id}`}>
            {user.githubLogin} 역할 변경
          </label>
          <select
            id={`role-${user.id}`}
            className="h-11 rounded-lg border border-input bg-background px-3 text-sm"
            value={user.role ?? ''}
            disabled={props.processingId === user.id}
            onChange={(event) => {
              const role = event.target.value as UserRole;
              if (role) props.onRequestRoleChange(user, role);
            }}
          >
            {!user.role ? <option value="">역할 선택</option> : null}
            {Object.entries(ROLE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </RowActions>
      ),
    },
  ];

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    props.onSearch();
  };

  return (
    <section className="flex flex-col gap-6 p-4 sm:p-6">
      <PageHeader
        title="사용자 관리"
        description="사용자를 검색하고 학생·교직원·관리자 역할을 변경합니다."
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
      <form
        className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto]"
        onSubmit={submitSearch}
      >
        <Input
          className="h-11"
          aria-label="이름 또는 GitHub 닉네임 검색"
          placeholder="이름 또는 GitHub 닉네임"
          value={props.query}
          onChange={(event) => props.onQueryChange(event.target.value)}
        />
        <label className="sr-only" htmlFor="admin-user-role-filter">
          역할 필터
        </label>
        <select
          id="admin-user-role-filter"
          className="h-11 rounded-lg border border-input bg-background px-3 text-sm"
          value={props.role}
          onChange={(event) =>
            props.onRoleChange(event.target.value as UserRole | '')
          }
        >
          <option value="">전체 역할</option>
          {Object.entries(ROLE_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <Button className="h-11" type="submit" variant="outline">
          검색
        </Button>
      </form>
      <div className="rounded-lg border border-border">
        <DataTable
          columns={columns}
          data={[...props.items]}
          rowKey={(user) => user.id}
          isLoading={props.isLoading}
          loadingSlot="사용자 목록을 불러오는 중…"
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
      {props.successMessage ? (
        <div
          className="fixed right-4 bottom-4 z-40 rounded-lg border border-border bg-background px-4 py-3 text-sm shadow-lg"
          role="status"
        >
          {props.successMessage}
        </div>
      ) : null}
      {props.confirmation ? (
        <AdminRoleChangeDialog
          user={props.confirmation.user}
          role={props.confirmation.role}
          isProcessing={props.processingId === props.confirmation.user.id}
          onCancel={props.onCancelConfirmation}
          onConfirm={props.onConfirmRoleChange}
        />
      ) : null}
    </section>
  );
}

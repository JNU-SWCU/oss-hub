import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight, ChevronUp } from 'lucide-react';

import { DataTable, type DataTableColumn } from '@/components';

import type {
  AdminAccessListItem,
  AdminAccessSortDirection,
  AdminAccessSortField,
} from '../admin-access-api';
import type { AccessWorkspace } from '../admin-access-list-query';
import {
  AccountStatusBadge,
  AdminAccessUserCell,
  formatAdminAccessDate,
  RoleBadge,
} from './admin-access-table-cell';

interface AdminAccessTableProps {
  readonly workspace: AccessWorkspace;
  readonly items: readonly AdminAccessListItem[];
  readonly sort: AdminAccessSortField;
  readonly direction: AdminAccessSortDirection;
  readonly isLoading: boolean;
  readonly emptyState: ReactNode;
  readonly onSortToggle: (field: AdminAccessSortField) => void;
  readonly onRowClick: (item: AdminAccessListItem) => void;
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
  const Icon = active && direction === 'desc' ? ChevronDown : ChevronUp;

  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 hover:text-foreground"
      onClick={() => onSortToggle(field)}
    >
      {label}
      <Icon
        aria-hidden="true"
        className={
          active ? 'size-4' : 'size-4 text-muted-foreground opacity-40'
        }
      />
    </button>
  );
}

function sortableColumn(
  props: AdminAccessTableProps,
  field: AdminAccessSortField,
  label: string,
  cell: (item: AdminAccessListItem) => ReactNode,
  muted = false,
  id: string = field,
): DataTableColumn<AdminAccessListItem> {
  return {
    id,
    header: (
      <SortableColumnHeader
        label={label}
        field={field}
        sort={props.sort}
        direction={props.direction}
        onSortToggle={props.onSortToggle}
      />
    ),
    headProps: {
      'aria-sort': sortAriaValue(props.sort === field, props.direction),
    },
    headClassName: 'hidden lg:table-cell',
    cellClassName: muted
      ? 'hidden lg:table-cell text-muted-foreground'
      : 'hidden lg:table-cell',
    cell,
  };
}

function adminAccessColumns(
  props: AdminAccessTableProps,
): DataTableColumn<AdminAccessListItem>[] {
  const isQueue = props.workspace === 'queue';
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
        <AdminAccessUserCell item={item} workspace={props.workspace} />
      ),
    },
  ];

  if (isQueue) {
    columns.push(
      sortableColumn(
        props,
        'createdAt',
        '요청 시각',
        (item) => formatAdminAccessDate(item.pendingRequest?.createdAt ?? null),
        true,
        'requestedAt',
      ),
    );
  } else {
    columns.push(
      sortableColumn(props, 'role', '역할', (item) => (
        <RoleBadge role={item.role} />
      )),
      sortableColumn(props, 'accountStatus', '계정 상태', (item) => (
        <AccountStatusBadge status={item.accountStatus} />
      )),
      sortableColumn(
        props,
        'createdAt',
        '가입 일시',
        (item) => formatAdminAccessDate(item.createdAt),
        true,
      ),
      sortableColumn(
        props,
        'lastLoginAt',
        '마지막 로그인',
        (item) => formatAdminAccessDate(item.lastLoginAt),
        true,
      ),
    );
  }

  columns.push({
    id: 'chevron',
    header: <span className="sr-only">상세</span>,
    headClassName: 'w-8',
    cellClassName: 'w-8 text-right',
    cell: () => (
      <ChevronRight
        aria-hidden="true"
        className="size-4 text-muted-foreground"
      />
    ),
  });

  return columns;
}

export function AdminAccessTable(props: AdminAccessTableProps) {
  const isQueue = props.workspace === 'queue';

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <DataTable
        scrollRegionLabel={isQueue ? '가입 신청 표' : '사용자 목록 표'}
        columns={adminAccessColumns(props)}
        data={[...props.items]}
        rowKey={(item) => item.id}
        onRowClick={(item) => props.onRowClick(item)}
        isLoading={props.isLoading}
        loadingSlot={
          isQueue ? '가입 신청을 불러오는 중…' : '사용자 목록을 불러오는 중…'
        }
        emptyState={props.emptyState}
      />
    </div>
  );
}

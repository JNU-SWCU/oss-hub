import type { SubmitEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ACCOUNT_STATUS_LABEL,
  ROLE_LABEL,
  UNASSIGNED_ROLE_LABEL,
} from '@/lib/status-vocabulary';

import type {
  AdminAccessAccountStatus,
  AdminAccessRoleFilter,
} from '../admin-access-api';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './role-select';

// 거르기 목록 순서: 미지정이 먼저다(역할을 아직 주지 않은 계정부터 살핀다).
const ROLE_FILTER_LABEL: Record<AdminAccessRoleFilter, string> = {
  UNASSIGNED: UNASSIGNED_ROLE_LABEL,
  ...ROLE_LABEL,
};

const ALL_ROLES = 'ALL_ROLES';
const ALL_ACCOUNT_STATUSES = 'ALL_ACCOUNT_STATUSES';

function isRoleFilter(value: string): value is AdminAccessRoleFilter {
  return value in ROLE_FILTER_LABEL;
}

function isAccountStatus(value: string): value is AdminAccessAccountStatus {
  return value in ACCOUNT_STATUS_LABEL;
}

interface AdminAccessFiltersProps {
  readonly isQueue: boolean;
  readonly query: string;
  readonly role: AdminAccessRoleFilter | '';
  readonly accountStatus: AdminAccessAccountStatus | '';
  readonly onQueryChange: (query: string) => void;
  readonly onSearch: () => void;
  readonly onRoleChange: (role: AdminAccessRoleFilter | '') => void;
  readonly onAccountStatusChange: (
    status: AdminAccessAccountStatus | '',
  ) => void;
}

export function AdminAccessFilters(props: AdminAccessFiltersProps) {
  const submitSearch = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    props.onSearch();
  };

  return (
    <form
      className={
        props.isQueue
          ? 'grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]'
          : 'grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_9rem_9rem_auto]'
      }
      onSubmit={submitSearch}
    >
      <Input
        className="h-11"
        aria-label="이름 또는 GitHub 닉네임 검색"
        placeholder="이름 또는 GitHub 닉네임"
        value={props.query}
        onChange={(event) => props.onQueryChange(event.target.value)}
      />
      {props.isQueue ? null : (
        <>
          <label className="sr-only" htmlFor="admin-access-role-filter">
            역할 필터
          </label>
          <Select
            value={props.role || ALL_ROLES}
            onValueChange={(role) =>
              props.onRoleChange(
                role === ALL_ROLES || !isRoleFilter(role) ? '' : role,
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
                status === ALL_ACCOUNT_STATUSES || !isAccountStatus(status)
                  ? ''
                  : status,
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
        </>
      )}
      <Button className="h-11" type="submit" variant="outline">
        검색
      </Button>
    </form>
  );
}

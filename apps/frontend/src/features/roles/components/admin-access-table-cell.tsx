import Link from 'next/link';
import { ExternalLink } from 'lucide-react';

import { StatusBadge } from '@/components';

import type {
  AdminAccessAccountStatus,
  AdminAccessListItem,
  AdminAccessRole,
} from '../admin-access-api';
import {
  accessDetailPath,
  type AccessWorkspace,
} from '../admin-access-list-query';

const ROLE_LABEL: Record<AdminAccessRole, string> = {
  STUDENT: '학생',
  STAFF: '교직원',
  ADMIN: '관리자',
};

const ACCOUNT_STATUS_LABEL: Record<AdminAccessAccountStatus, string> = {
  ACTIVE: '활성',
  DEACTIVATED: '비활성',
};

export function formatAdminAccessDate(value: string | null): string {
  if (!value) return '기록 없음';
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function RoleBadge({ role }: { readonly role: AdminAccessRole | null }) {
  if (!role) {
    return <StatusBadge variant="rejected">미지정</StatusBadge>;
  }
  return (
    <StatusBadge
      variant={
        role === 'ADMIN' ? 'approved' : role === 'STAFF' ? 'pending' : 'closed'
      }
    >
      {ROLE_LABEL[role]}
    </StatusBadge>
  );
}

export function AccountStatusBadge({
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

export function AdminAccessUserCell({
  item,
  workspace,
}: {
  readonly item: AdminAccessListItem;
  readonly workspace: AccessWorkspace;
}) {
  const isQueue = workspace === 'queue';

  return (
    <div className="flex min-w-0 flex-col gap-2 lg:min-w-48 lg:gap-1">
      <Link
        href={accessDetailPath(workspace, item.id)}
        className="line-clamp-2 break-all font-medium underline-offset-2 hover:underline"
        scroll={false}
      >
        {item.name ?? '이름 미등록'}
      </Link>
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">@{item.githubLogin}</span>
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
        {isQueue ? null : item.pendingRequest ? (
          <StatusBadge variant="pending">요청 대기</StatusBadge>
        ) : null}
        {isQueue ? (
          <span className="text-muted-foreground lg:hidden">
            {formatAdminAccessDate(item.pendingRequest?.createdAt ?? null)}
          </span>
        ) : (
          <div className="flex flex-wrap items-center gap-2 lg:hidden">
            <RoleBadge role={item.role} />
            <AccountStatusBadge status={item.accountStatus} />
            <span className="text-muted-foreground">
              가입 일시 {formatAdminAccessDate(item.createdAt)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

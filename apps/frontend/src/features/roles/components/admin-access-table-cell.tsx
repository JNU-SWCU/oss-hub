import Link from 'next/link';
import { ExternalLink } from 'lucide-react';

import { StatusBadge } from '@/components';
import {
  ACCOUNT_STATUS_BADGE,
  ACCOUNT_STATUS_LABEL,
  roleBadgeVariant,
  roleLabel,
} from '@/lib/status-vocabulary';

import type {
  AdminAccessAccountStatus,
  AdminAccessListItem,
  AdminAccessRole,
} from '../admin-access-api';
import {
  accessDetailPath,
  type AccessWorkspace,
} from '../admin-access-list-query';

export function formatAdminAccessDate(value: string | null): string {
  if (!value) return '기록 없음';
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function RoleBadge({ role }: { readonly role: AdminAccessRole | null }) {
  return (
    <StatusBadge variant={roleBadgeVariant(role)}>
      {roleLabel(role)}
    </StatusBadge>
  );
}

export function AccountStatusBadge({
  status,
}: {
  readonly status: AdminAccessAccountStatus;
}) {
  return (
    <StatusBadge variant={ACCOUNT_STATUS_BADGE[status]}>
      {ACCOUNT_STATUS_LABEL[status]}
    </StatusBadge>
  );
}

export function AdminAccessUserCell({
  item,
  workspace,
  listSearch = '',
}: {
  readonly item: AdminAccessListItem;
  readonly workspace: AccessWorkspace;
  /**
   * 목록이 지금 서 있는 질의(직렬화된 URL searchParams). 상세 주소에 그대로
   * 얹어, 오버레이 뒤에 깔린 목록이 검색·필터를 잃지 않게 한다. 훅으로 직접
   * 읽지 않고 prop 으로 받는다 — 이 셀은 라우터 없이도 그려지는 순수 표시
   * 부품이고, 실제로 라우터 없이 렌더하는 테스트가 있다.
   */
  readonly listSearch?: string;
}) {
  const isQueue = workspace === 'queue';

  return (
    <div className="flex min-w-0 flex-col gap-2 lg:min-w-48 lg:gap-1">
      <Link
        href={accessDetailPath(workspace, item.id, listSearch)}
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

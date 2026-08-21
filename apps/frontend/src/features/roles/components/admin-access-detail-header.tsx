import { ExternalLink } from 'lucide-react';
import { PageHeader, StatusBadge } from '@/components';
import {
  ACCOUNT_STATUS_LABEL,
  ROLE_LABEL,
} from '../admin-access-mutation-policy';
import type { CanonicalAdminAccessDetail } from '../independent-authority-api';
import type { AdminAccessDetailLayoutContext } from './admin-access-detail-layout';

type RoleBadgeVariant = 'approved' | 'pending' | 'closed';

function roleBadgeVariant(
  role: CanonicalAdminAccessDetail['role'],
): RoleBadgeVariant {
  switch (role) {
    case 'ADMIN':
      return 'approved';
    case 'STAFF':
      return 'pending';
    case 'STUDENT':
    case null:
      return 'closed';
  }
}

export function AdminAccessDetailHeader({
  detail,
  layoutContext,
}: {
  readonly detail: CanonicalAdminAccessDetail;
  readonly layoutContext: AdminAccessDetailLayoutContext;
}) {
  const isOverlay = layoutContext === 'overlay';
  return (
    <PageHeader
      titleAs={isOverlay ? 'h2' : 'h1'}
      className={isOverlay ? 'sm:flex-col sm:justify-start' : undefined}
      titleClassName={isOverlay ? 'sm:text-section' : undefined}
      title={detail.name ?? '이름 미등록'}
      description={
        <span className="flex flex-wrap items-center gap-1.5">
          @{detail.githubLogin}
          <a
            href={`https://github.com/${detail.githubLogin}`}
            target="_blank"
            rel="noreferrer"
            aria-label={`${detail.githubLogin}의 GitHub 프로필 (새 탭에서 열림)`}
            className="inline-flex items-center text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="size-4" aria-hidden="true" />
          </a>
        </span>
      }
      actions={
        <div className="flex flex-wrap gap-2">
          <StatusBadge variant={roleBadgeVariant(detail.role)}>
            {detail.role ? ROLE_LABEL[detail.role] : '미지정'}
          </StatusBadge>
          <StatusBadge
            variant={detail.accountStatus === 'ACTIVE' ? 'approved' : 'closed'}
          >
            {ACCOUNT_STATUS_LABEL[detail.accountStatus]}
          </StatusBadge>
        </div>
      }
    />
  );
}

import { StatusBadge } from '@/components';
import { AUDIT_LOG_ACTION_LABELS, type AuditLogAction } from './types';

export type ActionBadgeVariant =
  'approved' | 'closed' | 'pending' | 'recruiting' | 'rejected';

const ACTION_BADGE_VARIANTS = {
  STAFF_ROLE_REQUEST_APPROVED: 'approved',
  STAFF_ROLE_REQUEST_REJECTED: 'rejected',
  STAFF_ROLE_REQUEST_REVOKED: 'closed',
  STAFF_ROLE_REQUEST_RESTORED: 'approved',
  USER_ROLE_CHANGED: 'closed',
  USER_ACCOUNT_STATUS_CHANGED: 'closed',
  REPOSITORY_PUBLISHED: 'approved',
  PROGRAM_ARCHIVED: 'closed',
  PROGRAM_RESTORED: 'approved',
  COLLECTION_SYNC_TRIGGERED: 'closed',
  SUBMISSION_FILE_CLEANUP_RETRY_RESET: 'closed',
  APPLICATION_APPROVED: 'approved',
  APPLICATION_REJECTED: 'rejected',
  APPLICATION_REVERTED: 'closed',
  USER_PROFILE_UPDATED: 'closed',
} as const satisfies Readonly<Record<AuditLogAction, ActionBadgeVariant>>;

function isAuditLogAction(action: string): action is AuditLogAction {
  return Object.hasOwn(AUDIT_LOG_ACTION_LABELS, action);
}

// audit-log-view.tsx의 내용 열 배지가 이 매핑을 그대로 재사용한다 — 라벨·톤이
// 화면 두 곳(과거 4열 표의 잔재 컴포넌트와 새 2열 표)에서 어긋나지 않게 한다.
export function resolveAuditLogActionBadge(action: string): {
  readonly label: string;
  readonly variant: ActionBadgeVariant;
} {
  const knownAction = isAuditLogAction(action) ? action : null;
  return {
    label: knownAction ? AUDIT_LOG_ACTION_LABELS[knownAction] : '기타 작업',
    variant: knownAction ? ACTION_BADGE_VARIANTS[knownAction] : 'closed',
  };
}

export function AuditLogActionValue({ action }: { readonly action: string }) {
  const { label, variant } = resolveAuditLogActionBadge(action);

  return (
    <span className="flex min-w-0 flex-col items-start gap-1.5">
      <StatusBadge variant={variant}>{label}</StatusBadge>
      <span className="max-w-full break-all font-mono text-[11px] leading-relaxed text-muted-foreground">
        {action}
      </span>
    </span>
  );
}

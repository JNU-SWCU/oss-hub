import { StatusBadge } from '@/components';
import { AUDIT_LOG_ACTION_LABELS, type AuditLogAction } from './types';

type ActionBadgeVariant =
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
} as const satisfies Readonly<Record<AuditLogAction, ActionBadgeVariant>>;

function isAuditLogAction(action: string): action is AuditLogAction {
  return Object.hasOwn(AUDIT_LOG_ACTION_LABELS, action);
}

export function AuditLogActionValue({ action }: { readonly action: string }) {
  const knownAction = isAuditLogAction(action) ? action : null;
  const label = knownAction
    ? AUDIT_LOG_ACTION_LABELS[knownAction]
    : '기타 작업';
  const variant = knownAction ? ACTION_BADGE_VARIANTS[knownAction] : 'closed';

  return (
    <span className="flex min-w-0 flex-col items-start gap-1.5">
      <StatusBadge variant={variant}>{label}</StatusBadge>
      <span className="max-w-full break-all font-mono text-[11px] leading-relaxed text-muted-foreground">
        {action}
      </span>
    </span>
  );
}

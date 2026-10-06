import type { StatusBadgeVariantName } from './status-badge-variant';

export type AdminAccessRoleKey = 'STUDENT' | 'STAFF' | 'ADMIN';
export type AccountStatusKey = 'ACTIVE' | 'DEACTIVATED';

export const ROLE_LABEL = {
  STUDENT: '학생',
  STAFF: '교직원',
  ADMIN: '관리자',
} as const satisfies Readonly<Record<AdminAccessRoleKey, string>>;

export const ROLE_BADGE = {
  STUDENT: 'closed',
  STAFF: 'pending',
  ADMIN: 'approved',
} as const satisfies Readonly<
  Record<AdminAccessRoleKey, StatusBadgeVariantName>
>;

export const UNASSIGNED_ROLE_LABEL = '미지정';
export const UNASSIGNED_ROLE_BADGE = 'closed' satisfies StatusBadgeVariantName;

export function roleLabel(role: AdminAccessRoleKey | null): string {
  return role ? ROLE_LABEL[role] : UNASSIGNED_ROLE_LABEL;
}

export function roleBadgeVariant(
  role: AdminAccessRoleKey | null,
): StatusBadgeVariantName {
  return role ? ROLE_BADGE[role] : UNASSIGNED_ROLE_BADGE;
}

export const ACCOUNT_STATUS_LABEL = {
  ACTIVE: '활성',
  DEACTIVATED: '비활성',
} as const satisfies Readonly<Record<AccountStatusKey, string>>;

export type AccessStateKey = 'GRANTED' | 'NONE';

export const ACCESS_STATE_LABEL = {
  GRANTED: '허용',
  NONE: '비허용',
} as const satisfies Readonly<Record<AccessStateKey, string>>;

export const ACCOUNT_STATUS_BADGE = {
  ACTIVE: 'approved',
  DEACTIVATED: 'closed',
} as const satisfies Readonly<Record<AccountStatusKey, StatusBadgeVariantName>>;

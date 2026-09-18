import type { StatusBadgeVariantName } from './status-badge-variant';

/** 계정 접근 관리 화면의 역할·계정 상태 어휘 단일 원본(R-35). */
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

/** 역할이 아직 없는 계정. 값이 없는 것이지 실패가 아니라 붉게 칠하지 않는다. */
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

export const ACCOUNT_STATUS_BADGE = {
  ACTIVE: 'approved',
  DEACTIVATED: 'closed',
} as const satisfies Readonly<Record<AccountStatusKey, StatusBadgeVariantName>>;

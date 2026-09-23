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

/**
 * 교직원·관리자 접근을 가졌는지 읽기용으로 쓰는 말(#1365). 「없음」은 한 번도
 * 받은 적 없는 계정과 회수된 계정 모두에 맞는 중립적인 말이라 골랐다 —
 * 「회수됨」은 이력이 있다는 뜻을 풍긴다. 배지는 두지 않는다. 이 값이 보이는
 * 자리(「접근 변경」 카드)는 바로 옆에 행동 버튼이 서는 곳이라, 배지를 붙이면
 * 머리말의 계정 상태 배지와 같은 사실이 두 번 강조된다(AP-1).
 */
export type AccessStateKey = 'GRANTED' | 'NONE';

export const ACCESS_STATE_LABEL = {
  GRANTED: '허용됨',
  NONE: '없음',
} as const satisfies Readonly<Record<AccessStateKey, string>>;

export const ACCOUNT_STATUS_BADGE = {
  ACTIVE: 'approved',
  DEACTIVATED: 'closed',
} as const satisfies Readonly<Record<AccountStatusKey, StatusBadgeVariantName>>;

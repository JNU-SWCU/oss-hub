import type {
  AdminAccessAccountStatus,
  AdminAccessListItem,
  AdminAccessPendingRequest,
  AdminAccessRole,
} from './admin-access-api-types';

export class AdminAccessResponseError extends Error {
  constructor() {
    super('관리자 접근 API 응답 형식이 올바르지 않습니다.');
    this.name = 'AdminAccessResponseError';
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isStrictIsoTimestamp(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  const timestamp = new Date(value);
  return (
    Number.isFinite(timestamp.getTime()) && timestamp.toISOString() === value
  );
}

export function isAdminAccessRole(value: unknown): value is AdminAccessRole {
  return value === 'STUDENT' || value === 'STAFF' || value === 'ADMIN';
}

export function isAdminAccessAccountStatus(
  value: unknown,
): value is AdminAccessAccountStatus {
  return value === 'ACTIVE' || value === 'DEACTIVATED';
}

export function isAdminAccessPendingRequest(
  value: unknown,
): value is AdminAccessPendingRequest {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    value.status === 'PENDING' &&
    isStrictIsoTimestamp(value.createdAt)
  );
}

export function isNullableAdminAccessPendingRequest(
  value: unknown,
): value is AdminAccessPendingRequest | null {
  return value === null || isAdminAccessPendingRequest(value);
}

export function isAdminAccessListItem(
  value: unknown,
): value is AdminAccessListItem {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.githubLogin) &&
    (value.name === null || typeof value.name === 'string') &&
    (value.role === null || isAdminAccessRole(value.role)) &&
    isAdminAccessAccountStatus(value.accountStatus) &&
    typeof value.isSelf === 'boolean' &&
    typeof value.isProfileComplete === 'boolean' &&
    isStrictIsoTimestamp(value.createdAt) &&
    isNullableAdminAccessPendingRequest(value.pendingRequest) &&
    (value.lastLoginAt === null || typeof value.lastLoginAt === 'string')
  );
}

import { ApiError } from '@/lib/api-client';
import type {
  AdminAccessConflictProjection,
  AdminAccessDecidedRequest,
  AdminAccessMutationResponse,
  AdminProfileUpdateResponse,
} from './admin-access-api-types';
import {
  AdminAccessResponseError,
  isAdminAccessAccountStatus,
  isAdminAccessRole,
  isNonEmptyString,
  isNullableAdminAccessPendingRequest,
  isRecord,
} from './admin-access-response-guards';

const ACCESS_STATE_MISMATCH_CODE = 'ROL_013';

function isAdminAccessDecidedRequest(
  value: unknown,
): value is AdminAccessDecidedRequest {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    (value.status === 'APPROVED' ||
      value.status === 'REJECTED' ||
      value.status === 'REVOKED')
  );
}

export function parseAdminAccessMutationResponse(
  value: unknown,
): AdminAccessMutationResponse {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !(value.role === null || isAdminAccessRole(value.role)) ||
    !isAdminAccessAccountStatus(value.accountStatus) ||
    !isNullableAdminAccessPendingRequest(value.pendingRequest) ||
    !(
      value.decidedRequest === null ||
      isAdminAccessDecidedRequest(value.decidedRequest)
    )
  ) {
    throw new AdminAccessResponseError();
  }
  return {
    id: value.id,
    role: value.role,
    accountStatus: value.accountStatus,
    pendingRequest: value.pendingRequest,
    decidedRequest: value.decidedRequest,
  };
}

function isAdminAccessConflictProjection(
  value: unknown,
): value is AdminAccessConflictProjection {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    (value.role === null || isAdminAccessRole(value.role)) &&
    isAdminAccessAccountStatus(value.accountStatus) &&
    isNullableAdminAccessPendingRequest(value.pendingRequest)
  );
}

export function parseAdminAccessConflictProjection(
  error: unknown,
): AdminAccessConflictProjection | null {
  if (
    !(error instanceof ApiError) ||
    error.problem.status !== 409 ||
    error.problem.code !== ACCESS_STATE_MISMATCH_CODE
  ) {
    return null;
  }
  const currentAccess: unknown = Reflect.get(error.problem, 'currentAccess');
  if (!isAdminAccessConflictProjection(currentAccess)) {
    throw new AdminAccessResponseError();
  }
  return currentAccess;
}

function isAdminProfileUpdateResponse(
  value: unknown,
): value is AdminProfileUpdateResponse {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    (value.name === null || typeof value.name === 'string') &&
    (value.studentId === null || typeof value.studentId === 'string') &&
    (value.department === null || typeof value.department === 'string')
  );
}

export function parseAdminProfileUpdateResponse(
  value: unknown,
): AdminProfileUpdateResponse {
  if (!isAdminProfileUpdateResponse(value)) {
    throw new AdminAccessResponseError();
  }
  return value;
}

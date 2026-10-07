import { ApiError, apiClient } from '@/lib/api-client';
import { isConsistentCompleteProfile } from './profile-requirements';
import type {
  CompleteProfileRequest,
  UpdateProfileRequest,
  UserProfile,
} from './types';

export type ProfileApiErrorKind =
  | 'unauthorized'
  | 'consent-required'
  | 'already-complete'
  | 'student-id-taken'
  | 'generic';

export class ProfileResponseError extends Error {
  constructor() {
    super('프로필 API 응답 형식이 올바르지 않습니다.');
    this.name = 'ProfileResponseError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseProfile(value: unknown): UserProfile {
  if (
    !isRecord(value) ||
    typeof value.name !== 'string' ||
    (value.studentId !== null && typeof value.studentId !== 'string') ||
    (value.staffNumber !== null && typeof value.staffNumber !== 'string') ||
    (value.department !== null && typeof value.department !== 'string') ||
    (value.phone !== null && typeof value.phone !== 'string') ||
    typeof value.isComplete !== 'boolean' ||
    (value.isComplete &&
      !isConsistentCompleteProfile({
        name: value.name,
        studentId: value.studentId,
        department: value.department,
        phone: value.phone,
      }))
  ) {
    throw new ProfileResponseError();
  }
  return {
    name: value.name,
    studentId: value.studentId,
    staffNumber: value.staffNumber,
    department: value.department,
    phone: value.phone,
    isComplete: value.isComplete,
  };
}

export async function getMyProfile(signal?: AbortSignal): Promise<UserProfile> {
  return parseProfile(
    await apiClient<unknown>(
      'users/me/profile',
      signal ? { signal } : undefined,
    ),
  );
}

export async function completeMyProfile(
  request: CompleteProfileRequest,
): Promise<UserProfile> {
  return parseProfile(
    await apiClient<unknown>('users/me/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    }),
  );
}

export async function updateMyProfile(
  request: UpdateProfileRequest,
): Promise<UserProfile> {
  return parseProfile(
    await apiClient<unknown>('users/me/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    }),
  );
}

export function classifyProfileApiError(error: unknown): ProfileApiErrorKind {
  if (!(error instanceof ApiError)) {
    return 'generic';
  }
  if (error.problem.status === 401) {
    return 'unauthorized';
  }
  if (error.problem.status === 422 && error.problem.code === 'CON_003') {
    return 'consent-required';
  }
  if (error.problem.status === 409 && error.problem.code === 'USR_001') {
    return 'already-complete';
  }

  if (error.problem.status === 409 && error.problem.code === 'USR_004') {
    return 'student-id-taken';
  }
  return 'generic';
}

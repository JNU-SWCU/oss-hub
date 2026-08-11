import { ApiError, apiClient } from '@/lib/api-client';

export interface AccountDeactivationResult {
  readonly accountStatus: 'DEACTIVATED';
}

export type AccountDeactivationErrorKind =
  'unauthorized' | 'last-active-admin' | 'generic';

export class AccountDeactivationResponseError extends Error {
  constructor() {
    super('계정 비활성화 API 응답 형식이 올바르지 않습니다.');
    this.name = 'AccountDeactivationResponseError';
  }
}

function parseAccountDeactivation(value: unknown): AccountDeactivationResult {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('accountStatus' in value) ||
    value.accountStatus !== 'DEACTIVATED'
  ) {
    throw new AccountDeactivationResponseError();
  }
  return { accountStatus: value.accountStatus };
}

export async function deactivateMyAccount(): Promise<AccountDeactivationResult> {
  return parseAccountDeactivation(
    await apiClient<unknown>('users/me/account/deactivate', {
      method: 'PATCH',
    }),
  );
}

export function classifyAccountDeactivationError(
  error: unknown,
): AccountDeactivationErrorKind {
  if (!(error instanceof ApiError)) return 'generic';
  if (error.problem.status === 401) return 'unauthorized';
  if (error.problem.status === 409 && error.problem.code === 'USR_007') {
    return 'last-active-admin';
  }
  return 'generic';
}

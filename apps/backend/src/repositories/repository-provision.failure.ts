import { GithubOperationsError } from './github-app.error';

export const DEFAULT_PROVISION_JOB_LEASE_MS = 5 * 60_000;
export const DEFAULT_PROVISION_MAX_ATTEMPTS = 5;
export const DEFAULT_PROVISION_RETRY_BASE_MS = 60_000;

export const PROVISION_ERROR_CODES = {
  APPLICATION_NOT_APPROVED: 'REPOSITORY_PROVISION_APPLICATION_NOT_APPROVED',
  FEATURE_DISABLED: 'REPOSITORY_PROVISION_FEATURE_DISABLED',
  INVALID_EVENT: 'REPOSITORY_PROVISION_INVALID_EVENT',
  REPOSITORY_MISMATCH: 'REPOSITORY_PROVISION_REPOSITORY_MISMATCH',
  INTERNAL: 'REPOSITORY_PROVISION_INTERNAL',
} as const;

export interface RepositoryProvisionWorkerOptions {
  readonly leaseMs: number;
  readonly maxAttempts: number;
  readonly retryBaseMs: number;
}

export const DEFAULT_PROVISION_OPTIONS: RepositoryProvisionWorkerOptions = {
  leaseMs: DEFAULT_PROVISION_JOB_LEASE_MS,
  maxAttempts: DEFAULT_PROVISION_MAX_ATTEMPTS,
  retryBaseMs: DEFAULT_PROVISION_RETRY_BASE_MS,
};

export class RepositoryProvisionFailure extends Error {
  override readonly name = 'RepositoryProvisionFailure';

  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly retryAt: Date | null = null,
  ) {
    super(code);
  }
}

export function normalizeProvisionFailure(
  error: unknown,
): RepositoryProvisionFailure {
  if (error instanceof GithubOperationsError) {
    return new RepositoryProvisionFailure(
      error.code,
      error.retryable,
      error.retryAt,
    );
  }
  if (error instanceof RepositoryProvisionFailure) {
    return error;
  }
  return new RepositoryProvisionFailure(PROVISION_ERROR_CODES.INTERNAL, true);
}

export function finalProvisionFailure(
  code: string,
): RepositoryProvisionFailure {
  return new RepositoryProvisionFailure(code, false);
}

export function provisionRetryAt(
  failure: RepositoryProvisionFailure,
  attempt: number,
  now: Date,
  baseMs: number,
): Date {
  if (failure.retryAt !== null && failure.retryAt.getTime() > now.getTime()) {
    return failure.retryAt;
  }
  return new Date(now.getTime() + baseMs * 2 ** Math.max(0, attempt - 1));
}

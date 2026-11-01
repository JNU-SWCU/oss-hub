export const GITHUB_OPERATIONS_ERROR_CODES = {
  CONFIGURATION: 'GITHUB_OPERATIONS_CONFIGURATION',
  INSTALLATION_NOT_FOUND: 'GITHUB_OPERATIONS_INSTALLATION_NOT_FOUND',
  ORGANIZATION_MISMATCH: 'GITHUB_OPERATIONS_ORGANIZATION_MISMATCH',
  APP_ID_MISMATCH: 'GITHUB_OPERATIONS_APP_ID_MISMATCH',
  AUTHENTICATION: 'GITHUB_OPERATIONS_AUTHENTICATION',
  PERMISSION: 'GITHUB_OPERATIONS_PERMISSION',
  RATE_LIMITED: 'GITHUB_OPERATIONS_RATE_LIMITED',
  UPSTREAM: 'GITHUB_OPERATIONS_UPSTREAM',
  INVALID_RESPONSE: 'GITHUB_OPERATIONS_INVALID_RESPONSE',
  INVALID_INPUT: 'GITHUB_OPERATIONS_INVALID_INPUT',
  INVITATION_LIMIT: 'GITHUB_OPERATIONS_INVITATION_LIMIT',
} as const;

export type GithubOperationsErrorCode =
  (typeof GITHUB_OPERATIONS_ERROR_CODES)[keyof typeof GITHUB_OPERATIONS_ERROR_CODES];

export class GithubOperationsError extends Error {
  override readonly name = 'GithubOperationsError';

  constructor(
    readonly code: GithubOperationsErrorCode,
    readonly retryable: boolean,
    readonly retryAt: Date | null = null,
    options?: ErrorOptions,
  ) {
    super(code, options);
  }
}

const FALLBACK_RETRY_MS = 60_000;

const INVITATION_LIMIT_RETRY_MS = 24 * 60 * 60_000;

type UnknownRecordForGithubAppResponse = { readonly [key: string]: unknown };

export async function throwForGithubErrorResponse(
  response: Response,
  now: Date,
  invitation = false,
): Promise<void> {
  if (response.ok) {
    return;
  }
  const message = await readErrorMessage(response);
  if (isRateLimited(response, message)) {
    throw new GithubOperationsError(
      GITHUB_OPERATIONS_ERROR_CODES.RATE_LIMITED,
      true,
      retryAt(response.headers, now),
    );
  }
  if (invitation && response.status === 422 && message?.includes('limit')) {
    throw new GithubOperationsError(
      GITHUB_OPERATIONS_ERROR_CODES.INVITATION_LIMIT,
      true,
      new Date(now.getTime() + INVITATION_LIMIT_RETRY_MS),
    );
  }
  if (response.status >= 500) {
    throw new GithubOperationsError(
      GITHUB_OPERATIONS_ERROR_CODES.UPSTREAM,
      true,
    );
  }
  if (response.status === 401) {
    throw new GithubOperationsError(
      GITHUB_OPERATIONS_ERROR_CODES.AUTHENTICATION,
      false,
    );
  }
  const code =
    response.status === 403
      ? GITHUB_OPERATIONS_ERROR_CODES.PERMISSION
      : GITHUB_OPERATIONS_ERROR_CODES.INVALID_INPUT;
  throw new GithubOperationsError(code, false);
}

async function readErrorMessage(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    if (!isRecord(body) || typeof body.message !== 'string') {
      return null;
    }
    return body.message.toLowerCase();
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

function isRateLimited(response: Response, message: string | null): boolean {
  return (
    response.status === 429 ||
    (response.status === 403 &&
      (response.headers.get('x-ratelimit-remaining') === '0' ||
        response.headers.has('retry-after') ||
        message?.includes('secondary rate limit') === true))
  );
}

function retryAt(headers: Headers, now: Date): Date {
  const minimumRetryAt = new Date(now.getTime() + FALLBACK_RETRY_MS);
  const retryAfter = headers.get('retry-after');
  if (retryAfter !== null && /^\d+$/.test(retryAfter)) {
    return notBeforeMinimum(
      new Date(now.getTime() + Number(retryAfter) * 1_000),
      minimumRetryAt,
    );
  }
  const resetAt = headers.get('x-ratelimit-reset');
  if (resetAt !== null && /^\d+$/.test(resetAt)) {
    return notBeforeMinimum(new Date(Number(resetAt) * 1_000), minimumRetryAt);
  }
  return minimumRetryAt;
}

function notBeforeMinimum(candidate: Date, minimum: Date): Date {
  return Number.isNaN(candidate.getTime()) || candidate < minimum
    ? minimum
    : candidate;
}

function isRecord(value: unknown): value is UnknownRecordForGithubAppResponse {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

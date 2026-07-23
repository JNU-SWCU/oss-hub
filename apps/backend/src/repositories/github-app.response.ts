import {
  GITHUB_OPERATIONS_ERROR_CODES,
  GithubOperationsError,
} from './github-app.error';

const FALLBACK_RETRY_MS = 60_000;
const INVITATION_LIMIT_RETRY_MS = 24 * 60 * 60_000;

type UnknownRecord = { readonly [key: string]: unknown };

export type GithubRepositoryMetadata = {
  readonly githubRepositoryId: bigint;
  readonly name: string;
  readonly url: string;
  readonly visibility: 'PRIVATE' | 'PUBLIC';
  readonly description: string | null;
};

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

export function parseGithubRepository(
  value: unknown,
): GithubRepositoryMetadata {
  if (!isRecord(value)) {
    throw invalidGithubResponseError();
  }
  const id = value.id;
  const name = value.name;
  const url = value.html_url;
  const visibility = value.visibility;
  const description = value.description;
  if (
    typeof id !== 'number' ||
    !Number.isSafeInteger(id) ||
    typeof name !== 'string' ||
    typeof url !== 'string' ||
    !URL.canParse(url) ||
    (visibility !== 'private' && visibility !== 'public') ||
    (description !== null && typeof description !== 'string')
  ) {
    throw invalidGithubResponseError();
  }
  return {
    githubRepositoryId: BigInt(id),
    name,
    url,
    visibility: visibility === 'private' ? 'PRIVATE' : 'PUBLIC',
    description,
  };
}

export function parseInvitationLogins(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    throw invalidGithubResponseError();
  }
  return value.map((invitation) => {
    if (!isRecord(invitation) || !isRecord(invitation.invitee)) {
      throw invalidGithubResponseError();
    }
    const login = invitation.invitee.login;
    if (typeof login !== 'string') {
      throw invalidGithubResponseError();
    }
    return login;
  });
}

export async function readGithubJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw invalidGithubResponseError();
    }
    throw error;
  }
}

export function invalidGithubResponseError(): GithubOperationsError {
  return new GithubOperationsError(
    GITHUB_OPERATIONS_ERROR_CODES.INVALID_RESPONSE,
    false,
  );
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

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

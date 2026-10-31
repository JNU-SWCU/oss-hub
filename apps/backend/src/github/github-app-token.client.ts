import type { GithubAppCredentials } from './github-operations.config';
import { createPrivateKey } from 'node:crypto';
import { SignJWT } from 'jose';
import {
  GITHUB_OPERATIONS_ERROR_CODES,
  GithubOperationsError,
} from './github-app.error';

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

export function isRecord(
  value: unknown,
): value is UnknownRecordForGithubAppResponse {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type GithubAppFetcher = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export type GithubAppJwtFactory = (
  credentials: GithubAppCredentials,
  now: Date,
) => Promise<string>;

export interface GithubInstallationTokenProvider {
  readonly organization: string;
  accessToken(): Promise<string>;
  invalidateAccessToken(): void;
}

const GITHUB_API_BASE_URL = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';
const USER_AGENT = 'oss-hub-backend';
const TOKEN_REFRESH_MARGIN_MS = 5 * 60_000;

export async function createGithubAppJwt(
  credentials: GithubAppCredentials,
  now: Date,
): Promise<string> {
  try {
    const privateKey = createPrivateKey(credentials.privateKey);
    const nowSeconds = Math.floor(now.getTime() / 1_000);
    return new SignJWT({})
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(credentials.appId)
      .setIssuedAt(nowSeconds - 60)
      .setExpirationTime(nowSeconds + 9 * 60)
      .sign(privateKey);
  } catch (error) {
    if (error instanceof Error) {
      throw new GithubOperationsError(
        GITHUB_OPERATIONS_ERROR_CODES.CONFIGURATION,
        false,
      );
    }
    throw error;
  }
}

type InstallationToken = {
  readonly value: string;
  readonly expiresAt: Date;
};

type UnknownRecord = { readonly [key: string]: unknown };

export class GithubAppTokenClient implements GithubInstallationTokenProvider {
  private credentialsCache: GithubAppCredentials | null = null;
  private installationId: number | null = null;
  private installationToken: InstallationToken | null = null;
  private refreshPromise: Promise<string> | null = null;

  constructor(
    private readonly credentialsProvider: () => GithubAppCredentials,
    private readonly fetcher: GithubAppFetcher = globalThis.fetch,
    private readonly now: () => Date = () => new Date(),
    private readonly jwtFactory: GithubAppJwtFactory = createGithubAppJwt,
  ) {}

  get organization(): string {
    return this.credentials().organization;
  }

  async accessToken(): Promise<string> {
    const cached = this.installationToken;
    if (
      cached !== null &&
      cached.expiresAt.getTime() - this.now().getTime() >
        TOKEN_REFRESH_MARGIN_MS
    ) {
      return cached.value;
    }
    if (this.refreshPromise === null) {
      this.refreshPromise = this.refreshAccessToken().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  invalidateAccessToken(): void {
    this.installationToken = null;
  }

  private credentials(): GithubAppCredentials {
    if (this.credentialsCache === null) {
      this.credentialsCache = this.credentialsProvider();
    }
    return this.credentialsCache;
  }

  private async refreshAccessToken(): Promise<string> {
    const installationId = await this.getInstallationId();
    const jwt = await this.jwtFactory(this.credentials(), this.now());
    const response = await this.request(
      `${GITHUB_API_BASE_URL}/app/installations/${installationId}/access_tokens`,
      jwt,
      { method: 'POST' },
    );
    if (!response.ok) {
      await throwForGithubErrorResponse(response, this.now());
    }
    const body = await readJsonRecord(response);
    const token = body.token;
    const expiresAt = body.expires_at;
    if (
      typeof token !== 'string' ||
      token === '' ||
      typeof expiresAt !== 'string'
    ) {
      throw invalidResponseError();
    }
    const expiresTimestamp = Date.parse(expiresAt);
    if (Number.isNaN(expiresTimestamp)) {
      throw invalidResponseError();
    }
    this.installationToken = {
      value: token,
      expiresAt: new Date(expiresTimestamp),
    };
    return token;
  }

  private async getInstallationId(): Promise<number> {
    if (this.installationId !== null) {
      return this.installationId;
    }
    const credentials = this.credentials();
    const jwt = await this.jwtFactory(credentials, this.now());
    const response = await this.request(
      `${GITHUB_API_BASE_URL}/orgs/${encodeURIComponent(
        credentials.organization,
      )}/installation`,
      jwt,
    );
    if (!response.ok) {
      if (response.status === 404) {
        throw new GithubOperationsError(
          GITHUB_OPERATIONS_ERROR_CODES.INSTALLATION_NOT_FOUND,
          false,
        );
      }
      await throwForGithubErrorResponse(response, this.now());
    }
    const body = await readJsonRecord(response);
    const installationId = body.id;
    const installationAppId = body.app_id;
    const account = body.account;
    if (
      typeof installationId !== 'number' ||
      !Number.isSafeInteger(installationId) ||
      typeof installationAppId !== 'number' ||
      !Number.isSafeInteger(installationAppId) ||
      !isUnknownRecord(account) ||
      typeof account.login !== 'string'
    ) {
      throw invalidResponseError();
    }
    if (
      account.login.toLowerCase() !== credentials.organization.toLowerCase()
    ) {
      throw new GithubOperationsError(
        GITHUB_OPERATIONS_ERROR_CODES.ORGANIZATION_MISMATCH,
        false,
      );
    }
    if (String(installationAppId) !== credentials.appId) {
      throw new GithubOperationsError(
        GITHUB_OPERATIONS_ERROR_CODES.APP_ID_MISMATCH,
        false,
      );
    }
    this.installationId = installationId;
    return installationId;
  }

  private async request(
    url: string,
    jwt: string,
    init: RequestInit = {},
  ): Promise<Response> {
    try {
      return await this.fetcher(url, {
        ...init,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${jwt}`,
          'User-Agent': USER_AGENT,
          'X-GitHub-Api-Version': GITHUB_API_VERSION,
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      if (error instanceof Error) {
        throw new GithubOperationsError(
          GITHUB_OPERATIONS_ERROR_CODES.UPSTREAM,
          true,
        );
      }
      throw error;
    }
  }
}

async function readJsonRecord(response: Response): Promise<UnknownRecord> {
  try {
    const value: unknown = await response.json();
    if (!isUnknownRecord(value)) {
      throw invalidResponseError();
    }
    return value;
  } catch (error) {
    if (error instanceof GithubOperationsError) {
      throw error;
    }
    if (error instanceof SyntaxError) {
      throw invalidResponseError();
    }
    throw error;
  }
}

function isUnknownRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidResponseError(): GithubOperationsError {
  return new GithubOperationsError(
    GITHUB_OPERATIONS_ERROR_CODES.INVALID_RESPONSE,
    false,
  );
}

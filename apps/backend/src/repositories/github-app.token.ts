import { createPrivateKey } from 'node:crypto';
import { SignJWT } from 'jose';
import {
  GITHUB_OPERATIONS_ERROR_CODES,
  GithubOperationsError,
} from './github-app.error';
import { throwForGithubErrorResponse } from './github-app.response';

const GITHUB_API_BASE_URL = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';
const USER_AGENT = 'oss-hub-backend';
const TOKEN_REFRESH_MARGIN_MS = 5 * 60_000;

export interface GithubAppCredentials {
  readonly organization: string;
  readonly appId: string;
  readonly privateKey: string;
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

export class GithubAppTokenProvider implements GithubInstallationTokenProvider {
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
    const account = body.account;
    if (
      typeof installationId !== 'number' ||
      !Number.isSafeInteger(installationId) ||
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

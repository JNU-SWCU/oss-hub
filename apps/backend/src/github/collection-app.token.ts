import { createPrivateKey } from 'node:crypto';
import { importPKCS8, SignJWT } from 'jose';
import { CollectionAppConfigValues } from './collection-app.config';

const API_VERSION = '2022-11-28';
const EARLY_REFRESH_MS = 5 * 60_000;
const REQUIRED_PERMISSIONS = {
  contents: 'read',
  metadata: 'read',
  pull_requests: 'read',
} as const;

export class CollectionAppTokenError extends Error {
  readonly code = 'COLLECTION_APP_TOKEN_INVALID';
  constructor(
    readonly safeReason:
      'AUTH' | 'UPSTREAM' | 'INSTALLATION' | 'PERMISSIONS' | 'RESPONSE',
  ) {
    super(`Collection App token unavailable: ${safeReason}`);
    this.name = 'CollectionAppTokenError';
  }
}

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface CollectionAppInstallationIdentity {
  readonly appId: string;
  readonly installationId: string;
  readonly organizationId: string;
}

export class CollectionAppTokenProvider {
  private installation: CollectionAppInstallationIdentity | undefined;
  private installationRequest:
    Promise<CollectionAppInstallationIdentity> | undefined;
  private cached: { token: string; expiresAt: number } | undefined;
  private refresh: Promise<string> | undefined;

  constructor(
    private readonly config: CollectionAppConfigValues,
    private readonly fetcher: Fetcher = globalThis.fetch,
    private readonly now: () => number = Date.now,
  ) {}

  clear(expectedToken?: string): void {
    if (expectedToken === undefined || this.cached?.token === expectedToken) {
      this.cached = undefined;
    }
  }

  async getInstallationIdentity(
    signal?: AbortSignal,
  ): Promise<CollectionAppInstallationIdentity> {
    if (this.installation) return this.installation;
    if (this.installationRequest) return this.installationRequest;
    const requestSignal = this.deadlineSignal(signal);
    const request = this.discoverInstallation(requestSignal);
    this.installationRequest = request;
    try {
      return await request;
    } finally {
      if (this.installationRequest === request) {
        this.installationRequest = undefined;
      }
    }
  }

  async getToken(signal?: AbortSignal): Promise<string> {
    if (this.cached && this.cached.expiresAt - EARLY_REFRESH_MS > this.now()) {
      return this.cached.token;
    }
    if (this.refresh) return this.refresh;
    const refresh = this.refreshToken(this.deadlineSignal(signal));
    this.refresh = refresh;
    try {
      return await refresh;
    } finally {
      if (this.refresh === refresh) this.refresh = undefined;
    }
  }

  private deadlineSignal(signal?: AbortSignal): AbortSignal {
    return signal
      ? AbortSignal.any([signal, AbortSignal.timeout(this.config.deadlineMs)])
      : AbortSignal.timeout(this.config.deadlineMs);
  }

  private async discoverInstallation(
    signal: AbortSignal,
  ): Promise<CollectionAppInstallationIdentity> {
    const jwt = await this.createAppJwt();
    const installation = await this.request(
      `/orgs/${encodeURIComponent(this.config.orgLogin)}/installation`,
      jwt,
      'GET',
      signal,
      'INSTALLATION',
    );
    const identity = this.validateInstallation(installation);
    this.installation = identity;
    return identity;
  }

  private async refreshToken(signal: AbortSignal): Promise<string> {
    const identity = await this.getInstallationIdentity(signal);
    const jwt = await this.createAppJwt();
    const response = await this.request(
      `/app/installations/${identity.installationId}/access_tokens`,
      jwt,
      'POST',
      signal,
      'TOKEN',
    );
    const body = this.record(response);
    if (
      typeof body.token !== 'string' ||
      body.token.length === 0 ||
      typeof body.expires_at !== 'string'
    ) {
      throw new CollectionAppTokenError('RESPONSE');
    }
    const expiresAt = Date.parse(body.expires_at);
    if (!Number.isFinite(expiresAt) || expiresAt <= this.now()) {
      throw new CollectionAppTokenError('RESPONSE');
    }
    this.validatePermissions(body.permissions);
    if (body.repository_selection !== 'all') {
      throw new CollectionAppTokenError('PERMISSIONS');
    }
    this.cached = { token: body.token, expiresAt };
    return body.token;
  }

  private async createAppJwt(): Promise<string> {
    try {
      // GitHub App 키는 PKCS#1(`BEGIN RSA PRIVATE KEY`)로 다운로드되므로 PKCS#8로 정규화한다.
      const normalized = createPrivateKey(this.config.privateKey)
        .export({ type: 'pkcs8', format: 'pem' })
        .toString();
      const key = await importPKCS8(normalized, 'RS256');
      const nowSeconds = Math.floor(this.now() / 1000);
      return await new SignJWT({})
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuer(this.config.appId)
        .setIssuedAt(nowSeconds - 60)
        .setExpirationTime(nowSeconds + 9 * 60)
        .sign(key);
    } catch {
      throw new CollectionAppTokenError('RESPONSE');
    }
  }

  private async request(
    path: string,
    jwt: string,
    method: 'GET' | 'POST',
    signal: AbortSignal,
    context: 'INSTALLATION' | 'TOKEN',
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.config.apiBaseUrl}${path}`, {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${jwt}`,
          'User-Agent': 'oss-hub-collection-app',
          'X-GitHub-Api-Version': API_VERSION,
        },
        signal,
      });
    } catch {
      throw new CollectionAppTokenError('UPSTREAM');
    }
    if (!response.ok) {
      if (response.status === 403) {
        throw new CollectionAppTokenError('PERMISSIONS');
      }
      if (response.status === 401) {
        throw new CollectionAppTokenError(
          context === 'TOKEN' ? 'AUTH' : 'INSTALLATION',
        );
      }
      if (response.status === 404 || response.status === 422) {
        throw new CollectionAppTokenError('INSTALLATION');
      }
      throw new CollectionAppTokenError('UPSTREAM');
    }
    try {
      return await response.json();
    } catch {
      throw new CollectionAppTokenError('RESPONSE');
    }
  }

  private validateInstallation(
    value: unknown,
  ): CollectionAppInstallationIdentity {
    const body = this.record(value);
    if (this.positiveId(body.app_id) !== this.config.appId) {
      throw new CollectionAppTokenError('INSTALLATION');
    }
    if (body.repository_selection !== 'all') {
      throw new CollectionAppTokenError('INSTALLATION');
    }
    const account = this.record(body.account);
    if (
      typeof account.login !== 'string' ||
      account.login.toLowerCase() !== this.config.orgLogin.toLowerCase() ||
      account.type !== 'Organization'
    ) {
      throw new CollectionAppTokenError('INSTALLATION');
    }
    this.validatePermissions(body.permissions);
    return {
      appId: this.config.appId,
      installationId: this.positiveId(body.id),
      organizationId: this.positiveId(account.id),
    };
  }

  private positiveId(value: unknown): string {
    if (
      (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) ||
      (typeof value === 'string' && /^[1-9]\d*$/.test(value))
    ) {
      return String(value);
    }
    throw new CollectionAppTokenError('INSTALLATION');
  }

  private validatePermissions(value: unknown): void {
    const permissions = this.record(value);
    const entries = Object.entries(permissions);
    if (
      entries.length !== Object.keys(REQUIRED_PERMISSIONS).length ||
      entries.some(
        ([key, permission]) =>
          REQUIRED_PERMISSIONS[key as keyof typeof REQUIRED_PERMISSIONS] !==
          permission,
      )
    ) {
      throw new CollectionAppTokenError('PERMISSIONS');
    }
  }

  private record(value: unknown): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new CollectionAppTokenError('RESPONSE');
    }
    return value as Record<string, unknown>;
  }
}

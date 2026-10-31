import { MemberKind } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';
import type { RuntimeConfig } from './runtime-config.config';
import { RUNTIME_CONFIG } from './runtime-config-instance.config';

export type InitialAccountSeed = {
  readonly memberKind: MemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
};

export type InitialAccountSeedMap = ReadonlyMap<bigint, InitialAccountSeed>;

const ENTRY_RE = /^([1-9][0-9]*):(ADMIN|STAFF|STUDENT)$/;

export const INITIAL_ACCOUNT_SEEDS: Record<
  'ADMIN' | 'STAFF' | 'STUDENT',
  InitialAccountSeed
> = {
  STUDENT: {
    memberKind: MemberKind.STUDENT,
    hasStaffAccess: false,
    hasAdminAccess: false,
  },
  STAFF: {
    memberKind: MemberKind.STAFF,
    hasStaffAccess: true,
    hasAdminAccess: false,
  },
  ADMIN: {
    memberKind: null,
    hasStaffAccess: false,
    hasAdminAccess: true,
  },
};

export interface OauthSettings {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
}

const MIN_SESSION_SECRET_BYTES = 32;
const CALLBACK_PATH = '/api/v1/auth/github/callback';

@Injectable()
export class AuthConfig {
  private readonly runtimeConfig: RuntimeConfig;
  private readonly oauth: OauthSettings;

  readonly sessionSecret: Uint8Array;
  readonly frontendUrl: string;
  readonly allowedOrigin: string;
  readonly useSecureCookies: boolean;

  private readonly initialRoleMap: InitialAccountSeedMap;

  constructor(@Inject(RUNTIME_CONFIG) runtimeConfig: RuntimeConfig) {
    this.runtimeConfig = runtimeConfig;
    this.sessionSecret = this.loadSessionSecret();
    const frontend = this.loadFrontendUrl();
    this.frontendUrl = frontend.origin;
    this.allowedOrigin = this.frontendUrl;
    this.useSecureCookies = frontend.useSecureCookies;
    this.oauth = this.loadOauthSettings();
    this.initialRoleMap = AuthConfig.parseInitialRoles(
      this.runtimeConfig.AUTH_INITIAL_ROLES,
    );
  }

  static parseInitialRoles(raw: string | undefined): InitialAccountSeedMap {
    if (!raw?.trim()) {
      return new Map();
    }

    const map = new Map<bigint, InitialAccountSeed>();
    for (const piece of raw.split(',')) {
      const entry = piece.trim();
      const match = ENTRY_RE.exec(entry);
      const idRaw = match?.[1];
      const setting = match?.[2] as
        keyof typeof INITIAL_ACCOUNT_SEEDS | undefined;
      if (!idRaw || !setting) {
        throw new Error(
          'AUTH_INITIAL_ROLES 항목 형식은 "githubId:ADMIN|STAFF|STUDENT" 입니다.',
        );
      }

      const githubId = BigInt(idRaw);
      if (map.has(githubId)) {
        throw new Error('AUTH_INITIAL_ROLES에 중복된 githubId가 있습니다.');
      }
      map.set(githubId, INITIAL_ACCOUNT_SEEDS[setting]);
    }
    return map;
  }

  resolveInitialRole(githubId: bigint): InitialAccountSeed | null {
    return this.initialRoleMap.get(githubId) ?? null;
  }

  requireOauth(): OauthSettings {
    return this.oauth;
  }

  private loadSessionSecret(): Uint8Array {
    const raw = this.runtimeConfig.SESSION_SECRET;
    if (!raw) {
      throw new Error('SESSION_SECRET이 필수입니다.');
    }
    const decoded = Buffer.from(raw, 'base64url');
    if (decoded.length < MIN_SESSION_SECRET_BYTES) {
      throw new Error(
        `SESSION_SECRET은 base64url 인코딩된 ${MIN_SESSION_SECRET_BYTES}바이트 이상이어야 합니다.`,
      );
    }
    return new Uint8Array(decoded);
  }

  private loadFrontendUrl(): { origin: string; useSecureCookies: boolean } {
    const raw = this.runtimeConfig.FRONTEND_URL;
    if (!raw) {
      throw new Error('FRONTEND_URL이 필수입니다.');
    }
    const url = this.parseCanonicalOrigin(raw, 'FRONTEND_URL');
    return {
      origin: url.origin,
      useSecureCookies: url.protocol === 'https:',
    };
  }

  private loadOauthSettings(): OauthSettings {
    const clientId = this.runtimeConfig.GITHUB_OAUTH_CLIENT_ID;
    const clientSecret = this.runtimeConfig.GITHUB_OAUTH_CLIENT_SECRET;
    const callbackUrl = this.deriveCallbackUrl();
    const configuredCallbackUrl = this.runtimeConfig.GITHUB_OAUTH_CALLBACK_URL;

    if (configuredCallbackUrl !== undefined && configuredCallbackUrl !== '') {
      const normalizedConfiguredCallbackUrl = this.parseAbsoluteUrl(
        configuredCallbackUrl,
        'GITHUB_OAUTH_CALLBACK_URL',
      ).toString();
      if (normalizedConfiguredCallbackUrl !== callbackUrl) {
        throw new Error(
          `GITHUB_OAUTH_CALLBACK_URL은 FRONTEND_URL과 같은 origin의 ${CALLBACK_PATH}이어야 합니다.`,
        );
      }
    }

    if (!clientId || !clientSecret) {
      throw new Error('GITHUB_OAUTH_CLIENT_ID/SECRET이 필수입니다.');
    }
    return { clientId, clientSecret, callbackUrl };
  }

  private deriveCallbackUrl(): string {
    return `${this.frontendUrl}${CALLBACK_PATH}`;
  }

  private parseCanonicalOrigin(raw: string, envName: string): URL {
    const url = this.parseAbsoluteUrl(raw, envName);

    if (
      url.pathname !== '/' ||
      url.search !== '' ||
      url.hash !== '' ||
      hasRawQueryOrFragment(raw)
    ) {
      throw new Error(`${envName}은 path/query/hash 없는 origin이어야 합니다.`);
    }
    return url;
  }

  private parseAbsoluteUrl(raw: string, envName: string): URL {
    if (!/^https?:\/\//i.test(raw)) {
      throw new Error(`${envName}은 canonical http(s) URL이어야 합니다.`);
    }
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error(`${envName}은 절대 URL이어야 합니다.`);
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`${envName}은 http(s) URL이어야 합니다.`);
    }

    if (url.username || url.password || hasRawUserinfo(raw)) {
      throw new Error(`${envName}에는 credentials를 포함할 수 없습니다.`);
    }
    return url;
  }
}

function hasRawUserinfo(raw: string): boolean {
  const schemeSep = raw.indexOf('://');
  if (schemeSep < 0) {
    return false;
  }
  const hierarchical = raw.slice(schemeSep + 3);
  const authorityEnd = hierarchical.search(/[/?#]/);
  const authority =
    authorityEnd === -1 ? hierarchical : hierarchical.slice(0, authorityEnd);
  return authority.includes('@');
}

function hasRawQueryOrFragment(raw: string): boolean {
  const schemeSep = raw.indexOf('://');
  if (schemeSep < 0) {
    return false;
  }
  const hierarchical = raw.slice(schemeSep + 3);
  const authorityEnd = hierarchical.search(/[/?#]/);
  const afterAuthority =
    authorityEnd === -1 ? '' : hierarchical.slice(authorityEnd);
  return afterAuthority.includes('?') || afterAuthority.includes('#');
}

export const LOGIN_HISTORY_EVENTS = {
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
} as const;

export const LOGIN_HISTORY_PROVIDER = 'github' as const;

export const HTTP_AUTH_KINDS = {
  ANONYMOUS: 'ANONYMOUS',
  AUTHENTICATED: 'AUTHENTICATED',
} as const;

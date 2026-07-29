import { Inject, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import {
  loadRuntimeConfig,
  type RuntimeConfig,
} from '../runtime-config/runtime-config';
import { RUNTIME_CONFIG } from '../runtime-config/runtime-config.module';
import { parseInitialRoles } from './initial-roles';
import type { InitialRoleMap } from './initial-roles';

export interface OauthSettings {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
}

const MIN_SESSION_SECRET_BYTES = 32;
const CALLBACK_PATH = '/api/v1/auth/github/callback';

/**
 * auth 관련 env를 시작 시 한 번 검증해 고정한다.
 * 보안 정책은 NODE_ENV가 아니라 입력 값에서 파생한다.
 * - SESSION_SECRET·FRONTEND_URL·GitHub OAuth client ID/secret 누락 시 즉시 실패
 * - Secure cookie는 FRONTEND_URL scheme(https)에서만 켠다
 */
@Injectable()
export class AuthConfig {
  private readonly runtimeConfig: RuntimeConfig;
  private readonly oauth: OauthSettings;

  readonly sessionSecret: Uint8Array;
  readonly frontendUrl: string;
  readonly allowedOrigin: string;
  readonly useSecureCookies: boolean;

  private readonly initialRoleMap: InitialRoleMap;

  constructor(
    @Inject(RUNTIME_CONFIG)
    runtimeConfig: RuntimeConfig = loadRuntimeConfig(process.env),
  ) {
    this.runtimeConfig = runtimeConfig;
    this.sessionSecret = this.loadSessionSecret();
    const frontend = this.loadFrontendUrl();
    this.frontendUrl = frontend.origin;
    this.allowedOrigin = this.frontendUrl;
    this.useSecureCookies = frontend.useSecureCookies;
    this.oauth = this.loadOauthSettings();
    this.initialRoleMap = parseInitialRoles(
      this.runtimeConfig.AUTH_INITIAL_ROLES,
    );
  }

  /** 초기 역할 시드 대상이 아니면 null을 반환한다. */
  resolveInitialRole(githubId: bigint): Role | null {
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
    // WHATWG search/hash are empty for present-empty `?`/`#`; reject those via raw input.
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
    // WHATWG getters collapse present-empty userinfo (`https://@host`, `https://:@host`).
    if (url.username || url.password || hasRawUserinfo(raw)) {
      throw new Error(`${envName}에는 credentials를 포함할 수 없습니다.`);
    }
    return url;
  }
}

/**
 * Detect userinfo via the raw authority `@` delimiter.
 * Percent-encoded octets in the path are not authority userinfo.
 */
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

/**
 * Detect query/fragment delimiters on the raw input.
 * WHATWG `search`/`hash` are empty for present-empty `?`/`#`.
 */
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

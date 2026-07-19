import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { TestRole, TestRoleMap, loadTestRoleMap } from './test-role-map';

export interface OauthSettings {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
}

const MIN_SESSION_SECRET_BYTES = 32;
const DEV_FRONTEND_URL = 'http://localhost:3000';
const CALLBACK_PATH = '/api/v1/auth/github/callback';

/**
 * auth 관련 env를 시작 시 한 번 검증해 고정한다.
 * - 운영: 누락 시 즉시 실패 (fail-fast)
 * - 개발·테스트: SESSION_SECRET 없으면 임시 키(재시작 시 세션 전부 무효), OAuth 미설정이면
 *   로그인 엔드포인트 사용 시점에 오류
 */
@Injectable()
export class AuthConfig {
  private readonly logger = new Logger(AuthConfig.name);
  private readonly isProduction = process.env.NODE_ENV === 'production';
  private readonly oauth: OauthSettings | null;

  readonly sessionSecret: Uint8Array;
  readonly frontendUrl: string;
  readonly allowedOrigin: string;
  readonly useSecureCookies: boolean;

  private readonly testRoleMap: TestRoleMap;

  constructor() {
    this.sessionSecret = this.loadSessionSecret();
    this.frontendUrl = this.loadFrontendUrl();
    this.allowedOrigin = this.frontendUrl;
    this.useSecureCookies = this.isProduction;
    this.oauth = this.loadOauthSettings();
    // 테스트 전용 역할 매핑 (Issue #65) — 운영에서 설정이 존재하면 여기서 즉시 실패한다.
    this.testRoleMap = loadTestRoleMap(
      process.env.AUTH_TEST_ROLE_MAP,
      this.isProduction,
    );
  }

  /** 세션 JWT·User 영속화와 무관한 조회 전용 계약 — 미등록 ID는 null. */
  resolveTestRole(githubId: bigint): TestRole | null {
    return this.testRoleMap.get(githubId) ?? null;
  }

  requireOauth(): OauthSettings {
    if (!this.oauth) {
      // 서버 구성 문제 — 도메인 오류가 아니므로 전역 필터에서 SYS_*로 가려진다.
      throw new Error(
        'GitHub OAuth 환경변수가 없습니다 (GITHUB_OAUTH_CLIENT_ID/SECRET).',
      );
    }
    return this.oauth;
  }

  private loadSessionSecret(): Uint8Array {
    const raw = process.env.SESSION_SECRET;
    if (raw) {
      const decoded = Buffer.from(raw, 'base64url');
      if (decoded.length < MIN_SESSION_SECRET_BYTES) {
        throw new Error(
          `SESSION_SECRET은 base64url 인코딩된 ${MIN_SESSION_SECRET_BYTES}바이트 이상이어야 합니다.`,
        );
      }
      return new Uint8Array(decoded);
    }
    if (this.isProduction) {
      throw new Error('운영 환경에는 SESSION_SECRET이 필수입니다.');
    }
    this.logger.warn(
      'SESSION_SECRET 미설정 — 임시 키를 생성합니다 (재시작 시 모든 세션 무효).',
    );
    return new Uint8Array(randomBytes(MIN_SESSION_SECRET_BYTES));
  }

  private loadFrontendUrl(): string {
    const raw =
      process.env.FRONTEND_URL ?? (this.isProduction ? '' : DEV_FRONTEND_URL);
    if (!raw) {
      throw new Error('운영 환경에는 FRONTEND_URL이 필수입니다.');
    }
    return this.parseCanonicalOrigin(raw, 'FRONTEND_URL');
  }

  private loadOauthSettings(): OauthSettings | null {
    const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
    const callbackUrl = this.deriveCallbackUrl();
    const configuredCallbackUrl = process.env.GITHUB_OAUTH_CALLBACK_URL;

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
      if (this.isProduction) {
        throw new Error(
          '운영 환경에는 GITHUB_OAUTH_CLIENT_ID/SECRET이 필수입니다.',
        );
      }
      this.logger.warn(
        'GitHub OAuth 환경변수 미설정 — 로그인 엔드포인트는 구성 전까지 실패합니다.',
      );
      return null;
    }
    return { clientId, clientSecret, callbackUrl };
  }

  private deriveCallbackUrl(): string {
    return `${this.frontendUrl}${CALLBACK_PATH}`;
  }

  private parseCanonicalOrigin(raw: string, envName: string): string {
    const url = this.parseAbsoluteUrl(raw, envName);
    if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
      throw new Error(`${envName}은 path/query/hash 없는 origin이어야 합니다.`);
    }
    return url.origin;
  }

  private parseAbsoluteUrl(raw: string, envName: string): URL {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error(`${envName}은 절대 URL이어야 합니다.`);
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`${envName}은 http(s) URL이어야 합니다.`);
    }
    if (url.username || url.password) {
      throw new Error(`${envName}에는 credentials를 포함할 수 없습니다.`);
    }
    if (this.isProduction && url.protocol !== 'https:') {
      throw new Error(`운영 환경의 ${envName}은 HTTPS여야 합니다.`);
    }
    return url;
  }
}

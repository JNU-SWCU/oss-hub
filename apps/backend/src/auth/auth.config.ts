import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

export interface OauthSettings {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
}

const MIN_SESSION_SECRET_BYTES = 32;
const DEV_FRONTEND_URL = 'http://localhost:3000';
const DEV_CALLBACK_URL = 'http://localhost:4000/api/v1/auth/github/callback';

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

  constructor() {
    this.sessionSecret = this.loadSessionSecret();
    this.frontendUrl = this.loadFrontendUrl();
    this.allowedOrigin = new URL(this.frontendUrl).origin;
    this.useSecureCookies = this.isProduction;
    this.oauth = this.loadOauthSettings();
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
    const raw = process.env.FRONTEND_URL ?? (this.isProduction ? '' : DEV_FRONTEND_URL);
    if (!raw) {
      throw new Error('운영 환경에는 FRONTEND_URL이 필수입니다.');
    }
    // open redirect 방지 — 시작 시 검증된 고정 URL만 redirect 대상으로 쓴다.
    return new URL(raw).toString().replace(/\/$/, '');
  }

  private loadOauthSettings(): OauthSettings | null {
    const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
    const callbackUrl =
      process.env.GITHUB_OAUTH_CALLBACK_URL ??
      (this.isProduction ? undefined : DEV_CALLBACK_URL);

    if (!clientId || !clientSecret || !callbackUrl) {
      if (this.isProduction) {
        throw new Error(
          '운영 환경에는 GITHUB_OAUTH_CLIENT_ID/SECRET과 GITHUB_OAUTH_CALLBACK_URL이 필수입니다.',
        );
      }
      this.logger.warn(
        'GitHub OAuth 환경변수 미설정 — 로그인 엔드포인트는 구성 전까지 실패합니다.',
      );
      return null;
    }
    return { clientId, clientSecret, callbackUrl: new URL(callbackUrl).toString() };
  }
}

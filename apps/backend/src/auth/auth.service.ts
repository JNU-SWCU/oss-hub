import { Injectable } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import { DomainException } from '../common/error-code';
import { AUTH_ERROR_CODES, AuthErrorCode } from './auth-error-code.enum';
import { AuthConfig } from './auth.config';
import { AuthRepository } from './auth.repository';
import type {
  AuthLoginResult,
  AuthUser,
  GithubProfile,
} from './domain/auth-user';
import {
  createFlowState,
  decodeFlowCookie,
  encodeFlowCookie,
  isSameState,
  toCodeChallenge,
} from './oauth-flow';
import { issueSessionToken } from './session-token';

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_USER_URL = 'https://api.github.com/user';
const GITHUB_API_VERSION = '2022-11-28';
const USER_AGENT = 'oss-hub-backend';
const UPSTREAM_TIMEOUT_MS = 10_000;

export interface AuthorizeRedirect {
  url: string;
  flowCookieValue: string;
}

export interface CompleteLoginInput {
  code: string;
  state: string;
  flowCookie: string | undefined;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly config: AuthConfig,
    private readonly repository: AuthRepository,
  ) {}

  buildAuthorizeRedirect(): AuthorizeRedirect {
    const oauth = this.config.requireOauth();
    const flow = createFlowState();
    const url = new URL(GITHUB_AUTHORIZE_URL);
    url.searchParams.set('client_id', oauth.clientId);
    url.searchParams.set('redirect_uri', oauth.callbackUrl);
    url.searchParams.set('scope', 'read:user');
    url.searchParams.set('state', flow.state);
    url.searchParams.set('code_challenge', toCodeChallenge(flow.verifier));
    url.searchParams.set('code_challenge_method', 'S256');
    return { url: url.toString(), flowCookieValue: encodeFlowCookie(flow) };
  }

  /**
   * callback 유스케이스. 액세스 토큰은 프로필 확인에 한 번 쓰고 이 메서드 밖으로
   * 내보내지 않는다(저장 없음). 외부 HTTP가 끝난 뒤에만 DB 쓰기가 일어난다.
   */
  async completeLogin(input: CompleteLoginInput): Promise<AuthLoginResult> {
    const flow = decodeFlowCookie(input.flowCookie);
    if (!flow || !isSameState(flow.state, input.state)) {
      throw new DomainException(
        AUTH_ERROR_CODES[AuthErrorCode.OAUTH_FLOW_INVALID],
      );
    }
    const accessToken = await this.exchangeCode(input.code, flow.verifier);
    const profile = await this.fetchProfile(accessToken);
    return this.repository.withTransaction((store) =>
      store.upsertUser(profile),
    );
  }

  async issueSession(user: AuthUser): Promise<string> {
    this.requireActive(user);
    return issueSessionToken(this.config.sessionSecret, user.githubId);
  }

  async getMe(githubId: bigint): Promise<AuthUser> {
    const user = await this.repository.findByGithubId(githubId);
    return this.requireActive(user);
  }

  async findMe(githubId: bigint): Promise<AuthUser | null> {
    return this.repository.findByGithubId(githubId);
  }

  private requireActive(user: AuthUser | null): AuthUser {
    if (!user || user.accountStatus !== AccountStatus.ACTIVE) {
      throw new DomainException(
        AUTH_ERROR_CODES[AuthErrorCode.UNAUTHENTICATED],
      );
    }
    return user;
  }

  private async exchangeCode(code: string, verifier: string): Promise<string> {
    const oauth = this.config.requireOauth();
    const response = await fetch(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify({
        client_id: oauth.clientId,
        client_secret: oauth.clientSecret,
        code,
        redirect_uri: oauth.callbackUrl,
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`GitHub code 교환 실패 (HTTP ${response.status})`);
    }
    const body = (await response.json()) as Record<string, unknown>;
    const accessToken = body.access_token;
    if (typeof accessToken !== 'string' || accessToken.length === 0) {
      // 만료·재사용된 code 등 — 응답 본문은 로그에 남기지 않는다.
      throw new Error('GitHub code 교환 응답에 access_token이 없습니다.');
    }
    return accessToken;
  }

  private async fetchProfile(accessToken: string): Promise<GithubProfile> {
    const response = await fetch(GITHUB_USER_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': USER_AGENT,
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
      },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`GitHub 프로필 조회 실패 (HTTP ${response.status})`);
    }
    const body = (await response.json()) as Record<string, unknown>;
    if (typeof body.id !== 'number' || typeof body.login !== 'string') {
      throw new Error('GitHub 프로필 응답 형식이 올바르지 않습니다.');
    }
    return {
      githubId: BigInt(body.id),
      login: body.login,
      name: typeof body.name === 'string' ? body.name : null,
      avatarUrl: typeof body.avatar_url === 'string' ? body.avatar_url : null,
    };
  }
}

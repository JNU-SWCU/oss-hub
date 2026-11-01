import { Injectable, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthConfig, HTTP_AUTH_KINDS } from '../platform/auth.config';
import {
  AuthSessionService,
  SESSION_MAX_AGE_SECONDS,
} from '../platform/auth-session.service';
import { AuthService, LoginHistoryService } from './auth.service';
import type { AuthUser, OptionalSessionRequest } from './http-auth.types';

const FLOW_COOKIE_MAX_AGE_SECONDS = 600;

export interface GithubCallbackQuery {
  readonly code: string | undefined;
  readonly state: string | undefined;
  readonly oauthError: string | undefined;
}

@Injectable()
export class AuthFlowService {
  private readonly logger = new Logger(AuthFlowService.name);

  constructor(
    private readonly authService: AuthService,
    private readonly config: AuthConfig,
    private readonly loginHistoryService: LoginHistoryService,
    private readonly authSessionService: AuthSessionService,
  ) {}

  startGithubLogin(prompt: 'select_account' | undefined, res: Response): void {
    const redirect = this.authService.buildAuthorizeRedirect(prompt);
    res.setHeader(
      'Set-Cookie',
      this.authSessionService.serializeCookie(
        this.authSessionService.flowCookieName(this.config.useSecureCookies),
        redirect.flowCookieValue,
        {
          maxAgeSeconds: FLOW_COOKIE_MAX_AGE_SECONDS,
          secure: this.config.useSecureCookies,
        },
      ),
    );
    res.redirect(302, redirect.url);
  }

  async completeGithubCallback(
    { code, state, oauthError }: GithubCallbackQuery,
    req: Request,
    res: Response,
  ): Promise<void> {
    const secure = this.config.useSecureCookies;
    this.setCallbackSecurityHeaders(res);
    const cookies = this.authSessionService.parseCookies(req.headers.cookie);
    const clearFlowCookie = this.authSessionService.serializeCookie(
      this.authSessionService.flowCookieName(secure),
      '',
      {
        maxAgeSeconds: 0,
        secure,
      },
    );

    if (oauthError || !code || !state) {
      this.redirectWithError(
        res,
        this.shouldClearFlowCookie(
          state,
          cookies[this.authSessionService.flowCookieName(secure)],
        )
          ? clearFlowCookie
          : undefined,
      );
      return;
    }

    try {
      const login = await this.authService.completeLogin({
        code,
        state,
        flowCookie: cookies[this.authSessionService.flowCookieName(secure)],
      });
      const sessionToken = await this.authService.issueSession(login.user);
      await this.recordLoginHistory(login.user.id);
      res.setHeader('Set-Cookie', [
        clearFlowCookie,
        this.authSessionService.serializeCookie(
          this.authSessionService.sessionCookieName(secure),
          sessionToken,
          {
            maxAgeSeconds: SESSION_MAX_AGE_SECONDS,
            secure,
          },
        ),
      ]);
      res.redirect(
        302,
        this.authSessionService.loginLandingUrl(this.config.frontendUrl, login),
      );
    } catch (error) {
      this.logger.warn(
        `GitHub OAuth callback 실패: ${
          error instanceof Error ? error.name : 'UnknownError'
        } @ ${req.path}`,
      );

      this.redirectWithError(
        res,
        this.shouldClearFlowCookie(
          state,
          cookies[this.authSessionService.flowCookieName(secure)],
        )
          ? clearFlowCookie
          : undefined,
      );
    }
  }

  sessionUser(
    auth: OptionalSessionRequest['auth'],
    res: Response,
  ): AuthUser | undefined {
    switch (auth.kind) {
      case HTTP_AUTH_KINDS.ANONYMOUS:
        if (auth.hasSessionCookie) {
          this.clearSessionCookie(res);
        }
        return undefined;
      case HTTP_AUTH_KINDS.AUTHENTICATED:
        return auth.principal;
      default:
        return assertNeverHttpAuth(auth);
    }
  }

  async logout(
    auth: OptionalSessionRequest['auth'],
    res: Response,
  ): Promise<void> {
    this.clearSessionCookie(res);
    switch (auth.kind) {
      case HTTP_AUTH_KINDS.ANONYMOUS:
        return;
      case HTTP_AUTH_KINDS.AUTHENTICATED:
        await this.authService.incrementSessionVersion(auth.principal.githubId);
        await this.recordLogoutHistory(auth.principal.githubId);
        return;
      default:
        return assertNeverHttpAuth(auth);
    }
  }

  private async recordLoginHistory(userId: string): Promise<void> {
    try {
      await this.loginHistoryService.recordLogin(userId);
    } catch (error) {
      this.logHistoryFailure('login', error);
    }
  }

  private async recordLogoutHistory(githubId: bigint): Promise<void> {
    try {
      const user = await this.authService.findMe(githubId);
      if (user !== null) {
        await this.loginHistoryService.recordLogout(user.id);
      }
    } catch (error) {
      this.logHistoryFailure('logout', error);
    }
  }

  private logHistoryFailure(action: 'login' | 'logout', error: unknown): void {
    this.logger.warn(
      `${action} history 기록 실패: ${
        error instanceof Error ? error.name : 'UnknownError'
      }`,
    );
  }

  private clearSessionCookie(res: Response): void {
    res.setHeader(
      'Set-Cookie',
      this.authSessionService.serializeClearedSessionCookie(
        this.config.useSecureCookies,
      ),
    );
  }

  private redirectWithError(res: Response, clearFlowCookie?: string): void {
    if (clearFlowCookie) {
      res.setHeader('Set-Cookie', clearFlowCookie);
    }
    res.redirect(302, `${this.config.frontendUrl}/?authError=1`);
  }

  private shouldClearFlowCookie(
    receivedState: string | undefined,
    flowCookie: string | undefined,
  ): boolean {
    if (!receivedState) {
      return false;
    }
    const flow = this.authSessionService.decodeFlowCookie(flowCookie);
    return (
      flow !== null &&
      this.authSessionService.isSameState(flow.state, receivedState)
    );
  }

  private setCallbackSecurityHeaders(res: Response): void {
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
  }
}

function assertNeverHttpAuth(auth: never): never {
  throw new TypeError(`Unexpected HTTP authentication kind: ${String(auth)}`);
}

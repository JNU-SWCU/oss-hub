import {
  Controller,
  Get,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { LoginHistoryService } from '../../login-history/login-history.service';
import { AuthConfig } from '../auth.config';
import { OptionalSession, Protected, Public } from './auth-route-metadata';
import { AuthService } from '../service/auth.service';
import {
  flowCookieName,
  parseCookies,
  serializeClearedSessionCookie,
  serializeCookie,
  sessionCookieName,
} from '../domain/cookies';
import { loginLandingUrl } from '../domain/login-landing';
import { GithubLoginQueryRequestDto } from '../dto/github-login-query.dto';
import { LogoutResponseDto } from '../dto/logout-response.dto';
import { MeResponseDto, SessionResponseDto } from '../dto/session-response.dto';
import { decodeFlowCookie, isSameState } from '../domain/oauth-flow';
import { OriginGuard } from './origin.guard';
import {
  assertNeverHttpAuth,
  HTTP_AUTH_KINDS,
  type OptionalSessionRequest,
} from './http-auth';
import { SESSION_MAX_AGE_SECONDS } from '../domain/session-token';

const FLOW_COOKIE_MAX_AGE_SECONDS = 600;

@Controller('auth')
@Protected()
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly config: AuthConfig,
    private readonly loginHistoryService: LoginHistoryService,
  ) {}

  @Get('github')
  @Public()
  startGithubLogin(
    @Query() query: GithubLoginQueryRequestDto,
    @Res() res: Response,
  ): void {
    const redirect = this.authService.buildAuthorizeRedirect(query.prompt);
    res.setHeader(
      'Set-Cookie',
      serializeCookie(
        flowCookieName(this.config.useSecureCookies),
        redirect.flowCookieValue,
        {
          maxAgeSeconds: FLOW_COOKIE_MAX_AGE_SECONDS,
          secure: this.config.useSecureCookies,
        },
      ),
    );
    res.redirect(302, redirect.url);
  }

  @Get('github/callback')
  @Public()
  async githubCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') oauthError: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const secure = this.config.useSecureCookies;
    this.setCallbackSecurityHeaders(res);
    const cookies = parseCookies(req.headers.cookie);
    const clearFlowCookie = serializeCookie(flowCookieName(secure), '', {
      maxAgeSeconds: 0,
      secure,
    });

    if (oauthError || !code || !state) {
      this.redirectWithError(
        res,
        this.shouldClearFlowCookie(state, cookies[flowCookieName(secure)])
          ? clearFlowCookie
          : undefined,
      );
      return;
    }

    try {
      const login = await this.authService.completeLogin({
        code,
        state,
        flowCookie: cookies[flowCookieName(secure)],
      });
      const sessionToken = await this.authService.issueSession(login.user);
      await this.recordLoginHistory(login.user.id);
      res.setHeader('Set-Cookie', [
        clearFlowCookie,
        serializeCookie(sessionCookieName(secure), sessionToken, {
          maxAgeSeconds: SESSION_MAX_AGE_SECONDS,
          secure,
        }),
      ]);
      res.redirect(302, loginLandingUrl(this.config.frontendUrl, login));
    } catch (error) {
      this.logger.warn(
        `GitHub OAuth callback 실패: ${
          error instanceof Error ? error.name : 'UnknownError'
        } @ ${req.path}`,
      );

      this.redirectWithError(
        res,
        this.shouldClearFlowCookie(state, cookies[flowCookieName(secure)])
          ? clearFlowCookie
          : undefined,
      );
    }
  }

  @Get('session')
  @OptionalSession()
  getSession(
    @Req() req: OptionalSessionRequest,
    @Res({ passthrough: true }) res: Response,
  ): SessionResponseDto {
    switch (req.auth.kind) {
      case HTTP_AUTH_KINDS.ANONYMOUS:
        if (req.auth.hasSessionCookie) {
          this.clearSessionCookie(res);
        }
        return SessionResponseDto.anonymous();
      case HTTP_AUTH_KINDS.AUTHENTICATED:
        return SessionResponseDto.authenticated(
          MeResponseDto.from(req.auth.principal),
        );
      default:
        return assertNeverHttpAuth(req.auth);
    }
  }

  @Post('logout')
  @OptionalSession()
  @UseGuards(OriginGuard)
  @HttpCode(200)
  async logout(
    @Req() req: OptionalSessionRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LogoutResponseDto> {
    this.clearSessionCookie(res);
    switch (req.auth.kind) {
      case HTTP_AUTH_KINDS.ANONYMOUS:
        return new LogoutResponseDto(false);
      case HTTP_AUTH_KINDS.AUTHENTICATED:
        await this.authService.incrementSessionVersion(
          req.auth.principal.githubId,
        );
        await this.recordLogoutHistory(req.auth.principal.githubId);
        return new LogoutResponseDto(false);
      default:
        return assertNeverHttpAuth(req.auth);
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
      serializeClearedSessionCookie(this.config.useSecureCookies),
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
    const flow = decodeFlowCookie(flowCookie);
    return flow !== null && isSameState(flow.state, receivedState);
  }

  private setCallbackSecurityHeaders(res: Response): void {
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
  }
}

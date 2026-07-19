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
import { Role } from '@prisma/client';
import { Request, Response } from 'express';
import { AuthConfig } from './auth.config';
import { AuthService } from './auth.service';
import {
  flowCookieName,
  parseCookies,
  serializeCookie,
  sessionCookieName,
} from './cookies';
import { decodeFlowCookie, isSameState } from './oauth-flow';
import { LogoutResponseDto } from './dto/logout-response.dto';
import { MeResponseDto } from './dto/me-response.dto';
import { OriginGuard } from './origin.guard';
import { AuthenticatedRequest, SessionGuard } from './session.guard';
import { SESSION_MAX_AGE_SECONDS } from './session-token';

const FLOW_COOKIE_MAX_AGE_SECONDS = 600;

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly config: AuthConfig,
  ) {}

  @Get('github')
  startGithubLogin(@Res() res: Response): void {
    const redirect = this.authService.buildAuthorizeRedirect();
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

  /**
   * query의 code/state가 전역 필터 로그(originalUrl)로 새지 않도록, 이 핸들러는
   * 어떤 실패도 예외로 흘리지 않고 frontend 고정 오류 경로로 redirect한다.
   */
  @Get('github/callback')
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
      // 사용자가 GitHub에서 거부(access_denied)했거나 필수 파라미터 누락.
      // state가 현재 flow와 일치할 때만 flow 쿠키를 지워 unrelated flow를 보존한다.
      this.redirectWithError(
        res,
        this.shouldClearFlowCookie(state, cookies[flowCookieName(secure)])
          ? clearFlowCookie
          : undefined,
      );
      return;
    }

    try {
      const user = await this.authService.completeLogin({
        code,
        state,
        flowCookie: cookies[flowCookieName(secure)],
      });
      const sessionToken = await this.authService.issueSession(user);
      res.setHeader('Set-Cookie', [
        clearFlowCookie,
        serializeCookie(sessionCookieName(secure), sessionToken, {
          maxAgeSeconds: SESSION_MAX_AGE_SECONDS,
          secure,
        }),
      ]);
      res.redirect(302, this.config.frontendUrl);
    } catch (error) {
      // code·state는 로그에 남기지 않는다 — 오류 종류와 경로만.
      this.logger.warn(
        `GitHub OAuth callback 실패: ${
          error instanceof Error ? error.name : 'UnknownError'
        } @ ${req.path}`,
      );
      // completeLogin은 state 불일치도 예외로 보고하므로, 공격자가 보낸 callback이
      // unrelated flow를 취소하지 못하게 현재 flow와 일치할 때만 소비한다.
      this.redirectWithError(
        res,
        this.shouldClearFlowCookie(state, cookies[flowCookieName(secure)])
          ? clearFlowCookie
          : undefined,
      );
    }
  }

  @Get('me')
  @UseGuards(SessionGuard)
  async getMe(@Req() req: AuthenticatedRequest): Promise<MeResponseDto> {
    const user = await this.authService.getMe(req.sessionGithubId);
    return MeResponseDto.from(
      user,
      this.resolveRole(req.sessionGithubId, user.role),
    );
  }

  /**
   * role 정식 소스는 DB `User.role`이다(Issue #109). 로컬 `AUTH_TEST_ROLE_MAP`(Issue #65)에
   * 이 계정 항목이 있으면 그 값이 override로 우선한다 — 운영에서는 TestRoleMap이 항상
   * 비어 있으므로(fail-fast, `AuthConfig`) 이 분기는 로컬 전용이다.
   */
  private resolveRole(githubId: bigint, dbRole: Role | null): Role | null {
    const testRole = this.config.resolveTestRole(githubId);
    return testRole ? Role[testRole] : dbRole;
  }

  @Post('logout')
  @UseGuards(OriginGuard)
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response): LogoutResponseDto {
    const secure = this.config.useSecureCookies;
    res.setHeader(
      'Set-Cookie',
      serializeCookie(sessionCookieName(secure), '', {
        maxAgeSeconds: 0,
        secure,
      }),
    );
    return new LogoutResponseDto(false);
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

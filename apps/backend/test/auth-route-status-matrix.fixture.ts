import { randomBytes } from 'node:crypto';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AccountStatus } from '@prisma/client';
import { AuthenticationGuard } from '../src/auth/authentication.guard';
import { AuthConfig } from '../src/auth/auth.config';
import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { sessionCookieName } from '../src/auth/cookies';
import type { AuthUser } from '../src/auth/domain/auth-user';
import { OriginGuard } from '../src/auth/origin.guard';
import { SessionGuard } from '../src/auth/session.guard';
import {
  issueSessionToken,
  SESSION_MAX_AGE_SECONDS,
} from '../src/auth/session-token';
import { ProblemDetailFilter } from '../src/common/problem-detail.filter';
import { HealthController } from '../src/health/health.controller';
import { HealthService } from '../src/health/health.service';
import { LoginHistoryService } from '../src/login-history/login-history.service';
import { ProgramOverviewController } from '../src/programs/archive/program-overview/program-overview.controller';
import { ProgramOverviewService } from '../src/programs/archive/program-overview/program-overview.service';
import { ProgramsController } from '../src/programs/controller/programs.controller';
import { ProgramActivityService } from '../src/programs/service/program-activity.service';
import { ProgramCreationService } from '../src/programs/service/program-creation.service';
import { ProgramLifecycleService } from '../src/programs/service/program-lifecycle.service';
import { ProgramsService } from '../src/programs/service/programs.service';
import { ProgramViewerService } from '../src/programs/service/program-viewer.service';
import { RankingController } from '../src/ranking/controller/ranking.controller';
import { RankingService } from '../src/ranking/service/ranking.service';

const sessionSecret = new Uint8Array(randomBytes(32));
const syntheticGithubId = 424242n;
const syntheticUser: AuthUser = {
  id: 'synthetic-route-manifest-user',
  githubId: syntheticGithubId,
  nickname: 'synthetic-route-user',
  name: null,
  avatarUrl: null,
  accountStatus: AccountStatus.ACTIVE,
  sessionVersion: 0,
  memberKind: null,
  hasStaffAccess: false,
  hasAdminAccess: false,
  isProfileComplete: false,
};

export const AUTH_ROUTE_STATUS_CASES = {
  '/api/v1/auth/github': { anonymous: 302, authenticated: 302, expired: 302 },
  '/api/v1/auth/github/callback': {
    anonymous: 302,
    authenticated: 302,
    expired: 302,
  },
  '/api/v1/health': { anonymous: 200, authenticated: 200, expired: 200 },
  '/api/v1/programs': { anonymous: 200, authenticated: 200, expired: 200 },
  '/api/v1/programs/status-counts': {
    anonymous: 200,
    authenticated: 200,
    expired: 200,
  },
  '/api/v1/programs/synthetic-program': {
    anonymous: 200,
    authenticated: 200,
    expired: 200,
  },
  '/api/v1/ranking': { anonymous: 200, authenticated: 200, expired: 200 },
  '/api/v1/ranking/years': {
    anonymous: 200,
    authenticated: 200,
    expired: 200,
  },
  '/api/v1/auth/session': { anonymous: 200, authenticated: 200, expired: 200 },
} as const;

export class AuthRouteStatusHarness {
  private application: INestApplication | undefined;
  private baseUrl = '';
  private sessionCookie = '';
  private expiredSessionCookie = '';

  async start(): Promise<void> {
    const authService = {
      buildAuthorizeRedirect: jest.fn().mockReturnValue({
        flowCookieValue: 'synthetic-flow-cookie',
        url: 'https://github.example/login',
      }),
      findActivePrincipal: jest.fn().mockResolvedValue(syntheticUser),
      findMe: jest.fn().mockResolvedValue(syntheticUser),
      getMe: jest.fn().mockResolvedValue(syntheticUser),
    };
    const programsService = {
      list: jest.fn().mockResolvedValue({
        items: [],
        page: 1,
        pageSize: 20,
        totalItems: 0,
        totalPages: 0,
      }),
      statusCounts: jest.fn().mockResolvedValue({
        all: 0,
        recruiting: 0,
        in_progress: 0,
        upcoming: 0,
        ended: 0,
      }),
      detail: jest.fn().mockResolvedValue({ id: 'synthetic-program' }),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [
        AuthController,
        HealthController,
        ProgramsController,
        ProgramOverviewController,
        RankingController,
      ],
      providers: [
        AuthenticationGuard,
        SessionGuard,
        OriginGuard,
        { provide: AuthService, useValue: authService },
        {
          provide: AuthConfig,
          useValue: {
            allowedOrigin: 'http://frontend.test',
            frontendUrl: 'http://frontend.test',
            sessionSecret,
            useSecureCookies: false,
          },
        },
        {
          provide: LoginHistoryService,
          useValue: {
            recordLogin: jest.fn(),
            recordLogout: jest.fn(),
          },
        },
        {
          provide: HealthService,
          useValue: {
            isDatabaseReachable: jest.fn().mockResolvedValue(true),
          },
        },
        {
          provide: RankingService,
          useValue: {
            findPage: jest.fn().mockResolvedValue({
              year: 'all',
              items: [],
              page: 1,
              pageSize: 20,
              total: 0,
              dataAsOf: null,
              viewerClass: 'public',
              nextCycleAt: null,
            }),
            listYears: jest.fn().mockResolvedValue([]),
          },
        },
        { provide: ProgramCreationService, useValue: { create: jest.fn() } },
        { provide: ProgramsService, useValue: programsService },
        { provide: ProgramActivityService, useValue: { activity: jest.fn() } },
        {
          provide: ProgramViewerService,
          useValue: {
            fromGithubId: jest.fn().mockResolvedValue({
              githubId: null,
              userId: null,
              role: null,
            }),
          },
        },
        {
          provide: ProgramLifecycleService,
          useValue: { delete: jest.fn(), purge: jest.fn() },
        },
        {
          provide: ProgramOverviewService,
          useValue: {
            getOverview: jest.fn().mockResolvedValue({}),
            getPublicTeams: jest.fn().mockResolvedValue([]),
          },
        },
      ],
    }).compile();

    this.application = moduleRef.createNestApplication();
    this.application.useGlobalGuards(moduleRef.get(AuthenticationGuard));
    this.application.setGlobalPrefix('api/v1');
    this.application.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    this.application.useGlobalFilters(new ProblemDetailFilter());
    await this.application.listen(0, '127.0.0.1');
    this.baseUrl = await this.application.getUrl();
    this.sessionCookie = `${sessionCookieName(false)}=${await issueSessionToken(
      sessionSecret,
      syntheticGithubId,
      0,
    )}`;
    this.expiredSessionCookie = `${sessionCookieName(
      false,
    )}=${await issueSessionToken(
      sessionSecret,
      syntheticGithubId,
      0,
      Math.floor(Date.now() / 1000) - SESSION_MAX_AGE_SECONDS - 60,
    )}`;
  }

  async close(): Promise<void> {
    await this.application?.close();
  }

  status(
    path: string,
    session: 'anonymous' | 'authenticated' | 'expired',
  ): Promise<number> {
    let cookie: string | undefined;
    switch (session) {
      case 'anonymous':
        cookie = undefined;
        break;
      case 'authenticated':
        cookie = this.sessionCookie;
        break;
      case 'expired':
        cookie = this.expiredSessionCookie;
        break;
      default: {
        const unreachable: never = session;
        throw new Error(`Unknown session fixture: ${String(unreachable)}`);
      }
    }
    return fetch(`${this.baseUrl}${path}`, {
      headers:
        cookie === undefined
          ? { connection: 'close' }
          : { connection: 'close', cookie },
      redirect: 'manual',
    }).then((response) => response.status);
  }
}

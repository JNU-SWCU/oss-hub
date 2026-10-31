import { RankingYearService } from '../src/ranking/ranking-year.service';
import { AuthFlowService } from '../src/auth/auth-flow.service';
import { randomBytes } from 'node:crypto';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AccountStatus } from '@prisma/client';
import { AuthenticationGuard } from '../src/auth/authentication.guard';
import { AuthConfig } from '../src/platform/auth.config';
import { AuthController } from '../src/auth/auth.controller';
import { AuthService, LoginHistoryService } from '../src/auth/auth.service';
import type { AuthUser } from '../src/auth/http-auth.types';
import { OriginGuard } from '../src/platform/origin.guard';
import { ProblemDetailFilter } from '../src/platform/problem-detail.filter';
import { HealthController } from '../src/platform/health.controller';
import { HealthService } from '../src/platform/health.service';
import { ProgramOverviewController } from '../src/programs/program-overview.controller';
import { ProgramOverviewService } from '../src/programs/program-overview.service';
import { ProgramsController } from '../src/programs/programs.controller';
import { ProgramActivityService } from '../src/programs/program-activity.service';
import {
  ProgramCoverService,
  ProgramCreationService,
} from '../src/programs/program-creation.service';
import { ProgramEditorService } from '../src/programs/program-editor.service';
import { ProgramLifecycleService } from '../src/programs/program-lifecycle.service';
import { ProgramsService } from '../src/programs/programs.service';
import { ProgramViewerService } from '../src/programs/program-viewer.service';
import { RankingController } from '../src/ranking/ranking.controller';
import { RankingService } from '../src/ranking/ranking.service';
import {
  AuthSessionService,
  SESSION_MAX_AGE_SECONDS,
} from '../src/platform/auth-session.service';
import { STATELESS_PROVIDERS } from './stateless-providers.fixture';

const authSessionService = new AuthSessionService();

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
  '/api/v1/programs/ended-years': {
    anonymous: 200,
    authenticated: 200,
    expired: 200,
  },
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
    const viewerService = {
      fromGithubId: jest.fn().mockResolvedValue({
        githubId: null,
        userId: null,
        role: null,
      }),
    };
    const programsService = {
      endedYears: jest.fn().mockResolvedValue([2027, 2026]),
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
      detail: jest.fn().mockResolvedValue({
        id: 'synthetic-program',
        coverImageUrl: null,
        name: 'Synthetic program',
        organizer: 'Synthetic organizer',
        trackType: null,
        applicationTemplateKey: 'basic',
        lifecycle: 'PUBLISHED',
        description: 'Synthetic description',
        repositoryProvisioningEnabled: false,
        applicationPeriod: {
          startsAt: new Date('2026-10-01T00:00:00.000Z'),
          endsAt: new Date('2026-10-10T00:00:00.000Z'),
        },
        operatingPeriod: {
          startsAt: new Date('2026-10-11T00:00:00.000Z'),
          endsAt: new Date('2026-11-01T00:00:00.000Z'),
        },
        viewer: { role: null, applicationStatus: null },
        milestones: [],
      } satisfies Awaited<ReturnType<ProgramsService['detail']>>),
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
        AuthFlowService,
        ...STATELESS_PROVIDERS,
        AuthenticationGuard,
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
          useValue: Object.assign(
            Object.create(HealthService.prototype) as object,
            { isDatabaseReachable: jest.fn().mockResolvedValue(true) },
          ),
        },
        {
          provide: RankingService,
          useValue: Object.assign(
            Object.create(RankingService.prototype) as object,
            {
              rankingYearService: new RankingYearService(),
              ...{
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
          ),
        },
        { provide: ProgramCreationService, useValue: { create: jest.fn() } },
        { provide: ProgramCoverService, useValue: { read: jest.fn() } },
        {
          provide: ProgramEditorService,
          useValue: {
            getProgram: jest.fn(),
            updateProgram: jest.fn(),
            createMilestone: jest.fn(),
          },
        },
        {
          provide: ProgramsService,
          useValue: Object.assign(
            Object.create(ProgramsService.prototype) as object,
            programsService,
            { programViewerService: viewerService },
          ),
        },
        {
          provide: ProgramActivityService,
          useValue: Object.assign(
            Object.create(ProgramActivityService.prototype) as object,
            { activity: jest.fn(), programViewerService: viewerService },
          ),
        },
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
    })
      .useMocker((token) => (token === Function ? undefined : {}))
      .compile();

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
    this.sessionCookie = `${authSessionService.sessionCookieName(false)}=${await authSessionService.issueSessionToken(
      sessionSecret,
      syntheticGithubId,
      0,
    )}`;
    this.expiredSessionCookie = `${authSessionService.sessionCookieName(
      false,
    )}=${await authSessionService.issueSessionToken(
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
    }).then((response) => {
      if (
        path === '/api/v1/programs' ||
        path === '/api/v1/programs/ended-years'
      ) {
        expect(response.headers.get('Cache-Control')).toBe('private, no-store');
      }
      return response.status;
    });
  }
}

import { randomBytes } from 'node:crypto';
import { Controller, Get, type INestApplication } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { AccountStatus } from '@prisma/client';
import { AppModule } from '../app.module';
import { ProblemDetailFilter } from '../common/problem-detail.filter';
import { HealthController } from '../health/health.controller';
import { HealthService } from '../health/health.service';
import { LoginHistoryService } from '../login-history/login-history.service';
import { RankingController } from '../ranking/controller/ranking.controller';
import { RankingService } from '../ranking/service/ranking.service';
import { AuthConfig } from './auth.config';
import { AuthController } from './auth.controller';
import {
  AUTH_ROUTE_ACCESS,
  OptionalSession,
  Protected,
  Public,
} from './auth-route-metadata';
import {
  createAuthRouteManifest,
  type ControllerType,
} from './auth-route-manifest';
import { AuthService } from './auth.service';
import { sessionCookieName } from './cookies';
import type { AuthUser } from './domain/auth-user';
import { OriginGuard } from './origin.guard';
import { SessionGuard } from './session.guard';
import { issueSessionToken } from './session-token';

const sessionSecret = new Uint8Array(randomBytes(32));
const syntheticGithubId = 424242n;
const syntheticUser: AuthUser = {
  id: 'synthetic-route-manifest-user',
  githubId: syntheticGithubId,
  nickname: 'synthetic-route-user',
  name: null,
  avatarUrl: null,
  accountStatus: AccountStatus.ACTIVE,
  role: null,
  isProfileComplete: false,
};

@Controller('fixture/missing')
class MissingMetadataController {
  @Get()
  get(): void {}
}

@Protected()
@Controller('fixture/duplicate')
class DuplicateMetadataController {
  @Get()
  @Public()
  @OptionalSession()
  get(): void {}
}

function collectControllers(rootModule: ControllerType): ControllerType[] {
  const controllers = new Set<ControllerType>();
  const visitedModules = new Set<ControllerType>();

  function visit(moduleType: ControllerType): void {
    if (visitedModules.has(moduleType)) {
      return;
    }
    visitedModules.add(moduleType);

    const moduleControllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      moduleType,
    ) as ControllerType[] | undefined;
    for (const controller of moduleControllers ?? []) {
      controllers.add(controller);
    }

    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, moduleType) as
      Array<ControllerType | { module?: ControllerType }> | undefined;
    for (const imported of imports ?? []) {
      const importedModule =
        typeof imported === 'function' ? imported : imported.module;
      if (importedModule) {
        visit(importedModule);
      }
    }
  }

  visit(rootModule);
  return [...controllers];
}

describe('authentication route metadata manifest', () => {
  it('rejects missing or duplicate metadata', () => {
    expect(() => createAuthRouteManifest([MissingMetadataController])).toThrow(
      /missing authentication metadata/i,
    );
    expect(() =>
      createAuthRouteManifest([DuplicateMetadataController]),
    ).toThrow(/duplicate authentication metadata/i);
  });

  it('classifies every discovered route', () => {
    const manifest = createAuthRouteManifest(collectControllers(AppModule));
    const routesByAccess = {
      [AUTH_ROUTE_ACCESS.PUBLIC]: manifest.filter(
        (route) => route.access === AUTH_ROUTE_ACCESS.PUBLIC,
      ),
      [AUTH_ROUTE_ACCESS.OPTIONAL_SESSION]: manifest.filter(
        (route) => route.access === AUTH_ROUTE_ACCESS.OPTIONAL_SESSION,
      ),
      [AUTH_ROUTE_ACCESS.PROTECTED]: manifest.filter(
        (route) => route.access === AUTH_ROUTE_ACCESS.PROTECTED,
      ),
    };

    expect(routesByAccess[AUTH_ROUTE_ACCESS.PUBLIC]).toEqual([
      { method: 'GET', path: '/api/v1/auth/github', access: 'PUBLIC' },
      {
        method: 'GET',
        path: '/api/v1/auth/github/callback',
        access: 'PUBLIC',
      },
      { method: 'GET', path: '/api/v1/health', access: 'PUBLIC' },
      {
        method: 'GET',
        path: '/api/v1/programs/:programId/overview/teams',
        access: 'PUBLIC',
      },
      {
        method: 'GET',
        path: '/api/v1/programs/application-templates',
        access: 'PUBLIC',
      },
      { method: 'GET', path: '/api/v1/projects', access: 'PUBLIC' },
      {
        method: 'GET',
        path: '/api/v1/projects/:projectId',
        access: 'PUBLIC',
      },
      {
        method: 'GET',
        path: '/api/v1/projects/category-counts',
        access: 'PUBLIC',
      },
      { method: 'GET', path: '/api/v1/ranking/years', access: 'PUBLIC' },
      {
        method: 'GET',
        path: '/api/v1/users/:userId/public-profile',
        access: 'PUBLIC',
      },
      { method: 'POST', path: '/api/v1/auth/logout', access: 'PUBLIC' },
    ]);
    expect(routesByAccess[AUTH_ROUTE_ACCESS.OPTIONAL_SESSION]).toEqual([
      {
        method: 'GET',
        path: '/api/v1/auth/session',
        access: 'OPTIONAL_SESSION',
      },
      {
        method: 'GET',
        path: '/api/v1/ranking',
        access: 'OPTIONAL_SESSION',
      },
    ]);
    expect(routesByAccess[AUTH_ROUTE_ACCESS.PROTECTED]).not.toHaveLength(0);
    expect(
      new Set(manifest.map(({ method, path }) => `${method} ${path}`)).size,
    ).toBe(manifest.length);
  });

  describe('preserves current status matrix', () => {
    let application: INestApplication;
    let baseUrl: string;
    let sessionCookie: string;

    beforeAll(async () => {
      const authService = {
        buildAuthorizeRedirect: jest.fn().mockReturnValue({
          flowCookieValue: 'synthetic-flow-cookie',
          url: 'https://github.example/login',
        }),
        findMe: jest.fn().mockResolvedValue(syntheticUser),
        getMe: jest.fn().mockResolvedValue(syntheticUser),
      };
      const moduleRef = await Test.createTestingModule({
        controllers: [AuthController, HealthController, RankingController],
        providers: [
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
        ],
      }).compile();

      application = moduleRef.createNestApplication();
      application.setGlobalPrefix('api/v1');
      application.useGlobalFilters(new ProblemDetailFilter());
      await application.listen(0, '127.0.0.1');
      baseUrl = await application.getUrl();
      sessionCookie = `${sessionCookieName(false)}=${await issueSessionToken(
        sessionSecret,
        syntheticGithubId,
      )}`;
    });

    afterAll(async () => {
      await application.close();
    });

    async function status(path: string, cookie?: string): Promise<number> {
      const response = await fetch(`${baseUrl}${path}`, {
        headers: cookie
          ? { connection: 'close', cookie }
          : { connection: 'close' },
        redirect: 'manual',
      });
      return response.status;
    }

    it.each([
      ['/api/v1/auth/github', 302, 302],
      ['/api/v1/auth/github/callback', 302, 302],
      ['/api/v1/health', 200, 200],
      ['/api/v1/ranking', 200, 200],
      ['/api/v1/ranking/years', 200, 200],
      ['/api/v1/auth/session', 200, 200],
      ['/api/v1/auth/me', 401, 200],
    ])(
      '%s keeps anonymous=%i and authenticated=%i',
      async (path, anonymousStatus, authenticatedStatus) => {
        await expect(status(path)).resolves.toBe(anonymousStatus);
        await expect(status(path, sessionCookie)).resolves.toBe(
          authenticatedStatus,
        );
      },
    );
  });
});

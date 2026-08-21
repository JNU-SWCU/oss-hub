import { randomBytes } from 'node:crypto';
import {
  Controller,
  type DynamicModule,
  forwardRef,
  Get,
  type INestApplication,
  Module,
  RequestMethod,
  type Type,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { ApplicationConfig } from '@nestjs/core/application-config';
import { NestContainer } from '@nestjs/core/injector/container';
import { GraphInspector } from '@nestjs/core/inspector/graph-inspector';
import { MetadataScanner } from '@nestjs/core/metadata-scanner';
import { DependenciesScanner } from '@nestjs/core/scanner';
import { PathsExplorer } from '@nestjs/core/router/paths-explorer';
import { Test } from '@nestjs/testing';
import { AccountStatus } from '@prisma/client';
import {
  discoverAppModuleControllers,
  discoverModuleControllers,
} from '../app-controller-discovery';
import { AppModule } from '../app.module';
import { ProblemDetailFilter } from '../common/problem-detail.filter';
import { compareStringsByCodeUnit } from '../deterministic-string-order';
import { HealthController } from '../health/health.controller';
import { HealthService } from '../health/health.service';
import { LoginHistoryService } from '../login-history/login-history.service';
import { ProgramsController } from '../programs/controller/programs.controller';
import { ProgramActivityService } from '../programs/service/program-activity.service';
import { ProgramCreationService } from '../programs/service/program-creation.service';
import { ProgramLifecycleService } from '../programs/service/program-lifecycle.service';
import { ProgramsService } from '../programs/service/programs.service';
import { ProgramViewerService } from '../programs/service/program-viewer.service';
import { ProgramOverviewController } from '../programs/archive/program-overview/program-overview.controller';
import { ProgramOverviewService } from '../programs/archive/program-overview/program-overview.service';
import { RankingController } from '../ranking/controller/ranking.controller';
import { RankingService } from '../ranking/service/ranking.service';
import { AuthConfig } from './auth.config';
import { AuthController } from './auth.controller';
import {
  AUTH_ROUTE_ACCESS,
  OptionalSession,
  Protected,
  Public,
  PUBLIC_ROUTE_METADATA,
} from './auth-route-metadata';
import { createAuthRouteManifest } from './auth-route-manifest';
import {
  EXPECTED_APP_CONTROLLER_NAMES,
  EXPECTED_AUTH_ROUTE_INVENTORY,
} from './auth-route-inventory.fixture';
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

@Public()
@OptionalSession()
@Controller('fixture/masked-class-duplicate')
class MaskedClassDuplicateController {
  @Get()
  @Protected()
  get(): void {}
}

@Controller('fixture/masked-class-invalid')
class MaskedClassInvalidController {
  @Get()
  @Protected()
  get(): void {}
}
Reflect.defineMetadata(
  PUBLIC_ROUTE_METADATA,
  'invalid-public-marker',
  MaskedClassInvalidController,
);

@Controller('fixture/guard-conflict')
@UseGuards(SessionGuard)
class GuardConflictController {
  @Get()
  @Public()
  get(): void {}
}

@Public()
@Controller('fixture/masked-class-guard-conflict')
@UseGuards(SessionGuard)
class MaskedClassGuardConflictController {
  @Get()
  @Protected()
  get(): void {}
}

@Controller('fixture/dynamic')
class DynamicController {}

@Module({ controllers: [DynamicController] })
class DynamicFeatureModule {}

@Module({ imports: [forwardRef(() => DynamicFeatureModule)] })
class ForwardRefRootModule {}

async function discoverRuntimeControllers(): Promise<Type<unknown>[]> {
  const applicationConfig = new ApplicationConfig();
  const container = new NestContainer(applicationConfig);
  const scanner = new DependenciesScanner(
    container,
    new MetadataScanner(),
    new GraphInspector(container),
    applicationConfig,
  );
  await scanner.scan(AppModule);

  return [...container.getModules().values()]
    .flatMap((module) => [...module.controllers.values()])
    .map((wrapper) => wrapper.metatype)
    .filter((controller): controller is Type<unknown> => Boolean(controller));
}

function collectRuntimeRouteKeys(
  controllers: readonly Type<unknown>[],
): string[] {
  const pathsExplorer = new PathsExplorer(new MetadataScanner());

  return controllers
    .flatMap((controller) => {
      const prototype = controller.prototype as unknown as object;
      const controllerPathMetadata = Reflect.getMetadata(
        PATH_METADATA,
        controller,
      ) as string | string[];
      const controllerPaths = Array.isArray(controllerPathMetadata)
        ? controllerPathMetadata
        : [controllerPathMetadata];

      return pathsExplorer.scanForPaths(prototype, prototype).flatMap((route) =>
        controllerPaths.flatMap((controllerPath) =>
          route.path.map((handlerPath) => {
            const path = ['api/v1', controllerPath, handlerPath]
              .flatMap((segment) => segment.split('/'))
              .filter(Boolean)
              .join('/');
            return `${RequestMethod[route.requestMethod]} /${path}`;
          }),
        ),
      );
    })
    .sort(compareStringsByCodeUnit);
}

describe('authentication route metadata manifest', () => {
  it('rejects missing or duplicate metadata', () => {
    expect(() => createAuthRouteManifest([MissingMetadataController])).toThrow(
      /missing authentication metadata/i,
    );
    expect(() =>
      createAuthRouteManifest([DuplicateMetadataController]),
    ).toThrow(/duplicate authentication metadata/i);
    expect(() =>
      createAuthRouteManifest([MaskedClassDuplicateController]),
    ).toThrow(/duplicate authentication metadata.*class/i);
    expect(() =>
      createAuthRouteManifest([MaskedClassInvalidController]),
    ).toThrow(/invalid authentication metadata.*class/i);
    expect(() => createAuthRouteManifest([GuardConflictController])).toThrow(
      /conflicting authentication metadata.*sessionguard/i,
    );
    expect(() =>
      createAuthRouteManifest([MaskedClassGuardConflictController]),
    ).toThrow(/conflicting authentication metadata.*class/i);
  });

  it('fails closed on unsupported module import shapes', () => {
    const unsupportedImport = Promise.resolve({
      module: DynamicFeatureModule,
    } satisfies DynamicModule);

    @Module({ imports: [unsupportedImport] })
    class UnsupportedRootModule {}

    expect(() => discoverModuleControllers(UnsupportedRootModule)).toThrow(
      /unsupported nest module import.*promise/i,
    );
  });

  it('discovers forward references deterministically', () => {
    expect(discoverModuleControllers(ForwardRefRootModule)).toEqual([
      DynamicController,
    ]);
  });

  it('classifies every discovered route and locks the complete inventory', async () => {
    const controllers = discoverAppModuleControllers();
    const manifest = createAuthRouteManifest(controllers);
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

    expect(controllers.map((controller) => controller.name)).toEqual(
      EXPECTED_APP_CONTROLLER_NAMES,
    );
    expect(
      manifest.map(({ access, method, path }) => `${access} ${method} ${path}`),
    ).toEqual(EXPECTED_AUTH_ROUTE_INVENTORY);
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
        path: '/api/v1/programs/:id',
        access: 'PUBLIC',
      },
      {
        method: 'GET',
        path: '/api/v1/programs/application-templates',
        access: 'PUBLIC',
      },
      {
        method: 'GET',
        path: '/api/v1/programs/status-counts',
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
        path: '/api/v1/programs',
        access: 'OPTIONAL_SESSION',
      },
      {
        method: 'GET',
        path: '/api/v1/ranking',
        access: 'OPTIONAL_SESSION',
      },
    ]);
    expect(routesByAccess[AUTH_ROUTE_ACCESS.PROTECTED]).toHaveLength(105);
    expect(manifest).toHaveLength(120);
    expect(
      new Set(manifest.map(({ method, path }) => `${method} ${path}`)).size,
    ).toBe(manifest.length);

    const runtimeControllers = await discoverRuntimeControllers();

    expect(
      runtimeControllers
        .map((controller) => controller.name)
        .sort(compareStringsByCodeUnit),
    ).toEqual(controllers.map((controller) => controller.name));

    expect(collectRuntimeRouteKeys(runtimeControllers)).toEqual(
      manifest.map(({ method, path }) => `${method} ${path}`),
    );
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
          {
            provide: ProgramCreationService,
            useValue: { create: jest.fn() },
          },
          {
            provide: ProgramsService,
            useValue: programsService,
          },
          {
            provide: ProgramActivityService,
            useValue: { activity: jest.fn() },
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
      }).compile();

      application = moduleRef.createNestApplication();
      application.setGlobalPrefix('api/v1');
      application.useGlobalPipes(
        new ValidationPipe({
          transform: true,
          whitelist: true,
          forbidNonWhitelisted: true,
        }),
      );
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
      ['/api/v1/programs', 200, 200],
      ['/api/v1/programs/status-counts', 200, 200],
      ['/api/v1/programs/synthetic-program', 200, 200],
      ['/api/v1/programs/synthetic-program/overview/teams', 401, 200],
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

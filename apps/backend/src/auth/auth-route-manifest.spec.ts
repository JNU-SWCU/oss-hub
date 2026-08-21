import {
  discoverAppModuleControllers,
  discoverModuleControllers,
} from '../app-controller-discovery';
import { compareStringsByCodeUnit } from '../deterministic-string-order';
import { ProgramOverviewController } from '../programs/archive/program-overview/program-overview.controller';
import {
  collectRuntimeRouteKeys,
  discoverRuntimeControllers,
} from '../../test/auth-route-runtime-inventory.fixture';
import {
  DuplicateMetadataController,
  DynamicController,
  ForwardRefRootModule,
  GuardFallbackController,
  GuardMigrationController,
  MaskedClassDuplicateController,
  MaskedClassInvalidController,
  MethodOverrideMigrationController,
  MissingMetadataController,
  UnsupportedRootModule,
} from '../../test/auth-route-manifest-validation.fixture';
import {
  AUTH_ROUTE_STATUS_CASES,
  AuthRouteStatusHarness,
} from '../../test/auth-route-status-matrix.fixture';
import { AUTH_ROUTE_ACCESS } from './auth-route-metadata';
import {
  EXPECTED_APP_CONTROLLER_NAMES,
  EXPECTED_AUTH_ROUTE_INVENTORY,
} from './auth-route-inventory.fixture';
import { createAuthRouteManifest } from './auth-route-manifest';

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
  });

  it('keeps transitional SessionGuard enforcement separate from declared access', () => {
    expect(createAuthRouteManifest([GuardMigrationController])).toEqual([
      {
        access: 'PUBLIC',
        method: 'GET',
        path: '/api/v1/fixture/guard-migration',
      },
    ]);
    expect(
      createAuthRouteManifest([MethodOverrideMigrationController]),
    ).toEqual([
      {
        access: 'PROTECTED',
        method: 'GET',
        path: '/api/v1/fixture/method-override-migration',
      },
    ]);
  });

  it('classifies a route with only the current SessionGuard as protected', () => {
    expect(createAuthRouteManifest([GuardFallbackController])).toEqual([
      {
        access: 'PROTECTED',
        method: 'GET',
        path: '/api/v1/fixture/guard-fallback',
      },
    ]);
  });

  it('fails closed on unsupported module import shapes', () => {
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
      { method: 'GET', path: '/api/v1/programs/:id', access: 'PUBLIC' },
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
    expect(routesByAccess[AUTH_ROUTE_ACCESS.PUBLIC]).toHaveLength(13);
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
    expect(routesByAccess[AUTH_ROUTE_ACCESS.OPTIONAL_SESSION]).toHaveLength(3);
    expect(routesByAccess[AUTH_ROUTE_ACCESS.PROTECTED]).toHaveLength(103);
    expect(manifest).toHaveLength(119);
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
    const harness = new AuthRouteStatusHarness();

    beforeAll(async () => {
      await harness.start();
    });

    afterAll(async () => {
      await harness.close();
    });

    it.each(Object.entries(AUTH_ROUTE_STATUS_CASES))(
      '%s keeps the current anonymous/authenticated/expired statuses',
      async (path, expected) => {
        await expect(harness.status(path, 'anonymous')).resolves.toBe(
          expected.anonymous,
        );
        await expect(harness.status(path, 'authenticated')).resolves.toBe(
          expected.authenticated,
        );
        await expect(harness.status(path, 'expired')).resolves.toBe(
          expected.expired,
        );
      },
    );

    it('declares overview teams PUBLIC while its local guard keeps 401/200/401', async () => {
      const path = '/api/v1/programs/synthetic-program/overview/teams';
      expect(
        createAuthRouteManifest([ProgramOverviewController]),
      ).toContainEqual({
        access: 'PUBLIC',
        method: 'GET',
        path: '/api/v1/programs/:programId/overview/teams',
      });
      await expect(harness.status(path, 'anonymous')).resolves.toBe(401);
      await expect(harness.status(path, 'authenticated')).resolves.toBe(200);
      await expect(harness.status(path, 'expired')).resolves.toBe(401);
    });
  });
});

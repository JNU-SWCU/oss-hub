import { HttpException, RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { MetadataScanner } from '@nestjs/core/metadata-scanner';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  compareStringsByCodeUnit,
  discoverAppModuleControllers,
} from '../../src/app-controller-discovery';
import { createAuthRouteManifest } from '../../src/auth/auth-route-manifest.fixture';
import { AUTH_ROUTE_ACCESS } from '../../src/auth/authentication.guard';
import { DomainException } from '../../src/platform/error-code.error';
import { OriginGuard } from '../../src/platform/origin.guard';
import {
  ROLES_METADATA,
  RolesGuard,
  type RolesRequirement,
} from '../../src/platform/roles.guard';

interface RouteRolesEntry {
  readonly method: string;
  readonly path: string;
  readonly roles: readonly string[];
  readonly status: number;
  readonly error: string;
}

interface RoleRoute extends RouteRolesEntry {
  readonly guards: readonly unknown[];
}

function joinPath(...segments: readonly string[]): string {
  return `/${segments
    .flatMap((segment) => segment.split('/'))
    .filter(Boolean)
    .join('/')}`;
}

function describeForbidden(forbidden: () => Error) {
  const error = forbidden();
  if (error instanceof DomainException) {
    return { status: error.errorCode.status, error: error.errorCode.code };
  }
  if (error instanceof HttpException) {
    return { status: error.getStatus(), error: error.message };
  }
  throw new Error('Roles forbidden factory must build an HTTP error');
}

function roleRoutes(): RoleRoute[] {
  const scanner = new MetadataScanner();
  return discoverAppModuleControllers()
    .flatMap((controller) => {
      const prototype = controller.prototype as object;
      return scanner.getAllMethodNames(prototype).flatMap((name) => {
        const handler = Reflect.get(prototype, name) as object;
        const requirement = Reflect.getMetadata(ROLES_METADATA, handler) as
          RolesRequirement | undefined;
        if (requirement === undefined) {
          return [];
        }
        const method = Reflect.getMetadata(
          METHOD_METADATA,
          handler,
        ) as RequestMethod;
        return [
          {
            method: RequestMethod[method],
            path: joinPath(
              'api/v1',
              Reflect.getMetadata(PATH_METADATA, controller) as string,
              Reflect.getMetadata(PATH_METADATA, handler) as string,
            ),
            roles: requirement.roles,
            ...describeForbidden(requirement.forbidden),
            guards: Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[],
          },
        ];
      });
    })
    .sort(
      (left, right) =>
        compareStringsByCodeUnit(left.path, right.path) ||
        compareStringsByCodeUnit(left.method, right.method),
    );
}

describe('HTTP route roles', () => {
  it('keeps every route role and forbidden error unchanged', () => {
    const committed = JSON.parse(
      readFileSync(join(__dirname, 'route-roles.snapshot.json'), 'utf8'),
    ) as RouteRolesEntry[];

    expect(
      roleRoutes().map(({ method, path, roles, status, error }) => ({
        method,
        path,
        roles,
        status,
        error,
      })),
    ).toEqual(committed);
  });

  it('requires a protected session on every route with roles', () => {
    const access = new Map(
      createAuthRouteManifest(discoverAppModuleControllers()).map((route) => [
        `${route.method} ${route.path}`,
        route.access,
      ]),
    );

    for (const route of roleRoutes()) {
      expect([route.path, access.get(`${route.method} ${route.path}`)]).toEqual(
        [route.path, AUTH_ROUTE_ACCESS.PROTECTED],
      );
    }
  });

  it('checks Origin before roles on every route that has both', () => {
    for (const route of roleRoutes()) {
      const origin = route.guards.indexOf(OriginGuard);
      expect([route.path, route.guards.indexOf(RolesGuard)]).toEqual([
        route.path,
        origin + 1,
      ]);
    }
  });
});

import type { ExecutionContext } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { MetadataScanner } from '@nestjs/core/metadata-scanner';
import { discoverAppModuleControllers } from '../app-controller-discovery';
import { DomainException } from '../platform/error-code.error';
import { AUTH_ERROR_CODES, AuthErrorCode } from './auth-error-code.error';
import { createAuthRouteManifest } from './auth-route-manifest.fixture';
import type { AuthConfig } from '../platform/auth.config';
import { AuthModule } from './auth.module';
import type { AuthService } from './auth.service';
import { AuthSessionService } from '../platform/auth-session.service';
import {
  AUTH_ROUTE_ACCESS,
  type AuthRouteAccess,
  AuthenticationGuard,
} from './authentication.guard';
import { OriginGuard } from '../platform/origin.guard';
import { RolesGuard } from '../platform/roles.guard';

const unexpectedLookup = (): never => {
  throw new Error('anonymous request must not load a principal');
};

const guard = new AuthenticationGuard(
  new Reflector(),
  { sessionSecret: new Uint8Array(32) } as AuthConfig,
  {
    getMe: unexpectedLookup,
    findActivePrincipal: unexpectedLookup,
  } as unknown as AuthService,
  new AuthSessionService(),
);

function joinPath(...segments: string[]): string {
  return `/${segments
    .flatMap((segment) => segment.split('/'))
    .filter(Boolean)
    .join('/')}`;
}

async function anonymousAccess(
  controller: object,
  handler: object,
): Promise<AuthRouteAccess> {
  const request: { headers: object; auth?: { kind: string } } = {
    headers: {},
  };
  const context = {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({ setHeader: jest.fn() }),
    }),
  } as unknown as ExecutionContext;
  try {
    await guard.canActivate(context);
  } catch (error) {
    if (
      error instanceof DomainException &&
      error.errorCode === AUTH_ERROR_CODES[AuthErrorCode.UNAUTHENTICATED]
    ) {
      return AUTH_ROUTE_ACCESS.PROTECTED;
    }
    throw error;
  }
  return request.auth === undefined
    ? AUTH_ROUTE_ACCESS.PUBLIC
    : AUTH_ROUTE_ACCESS.OPTIONAL_SESSION;
}

describe('global authentication guard coverage', () => {
  const controllers = discoverAppModuleControllers();

  it('registers AuthenticationGuard as the application guard', () => {
    const providers: unknown = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      AuthModule,
    );

    expect(providers).toContainEqual({
      provide: APP_GUARD,
      useExisting: AuthenticationGuard,
    });
  });

  it('allows only OriginGuard and RolesGuard as route-level guards', () => {
    const scanner = new MetadataScanner();
    const routeGuards = controllers.flatMap((controller) => [
      ...((Reflect.getMetadata(GUARDS_METADATA, controller) as
        unknown[] | undefined) ?? []),
      ...scanner
        .getAllMethodNames(controller.prototype as object)
        .flatMap(
          (name) =>
            (Reflect.getMetadata(
              GUARDS_METADATA,
              Reflect.get(controller.prototype as object, name) as object,
            ) as unknown[] | undefined) ?? [],
        ),
    ]);

    expect(new Set(routeGuards)).toEqual(new Set([OriginGuard, RolesGuard]));
  });

  it('rejects anonymous requests on every route that is not public or optional', async () => {
    const scanner = new MetadataScanner();
    const expected = Object.fromEntries(
      createAuthRouteManifest(controllers).map(({ method, path, access }) => [
        `${method} ${path}`,
        access,
      ]),
    );
    const observed: Record<string, AuthRouteAccess> = {};

    for (const controller of controllers) {
      const controllerPath = Reflect.getMetadata(
        PATH_METADATA,
        controller,
      ) as string;
      for (const name of scanner.getAllMethodNames(
        controller.prototype as object,
      )) {
        const handler = Reflect.get(
          controller.prototype as object,
          name,
        ) as object;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as
          RequestMethod | undefined;
        if (method === undefined) {
          continue;
        }
        const path = joinPath(
          'api/v1',
          controllerPath,
          Reflect.getMetadata(PATH_METADATA, handler) as string,
        );
        observed[`${RequestMethod[method]} ${path}`] = await anonymousAccess(
          controller,
          handler,
        );
      }
    }

    expect(observed).toEqual(expected);
    expect(
      Object.values(observed).filter(
        (access) => access === AUTH_ROUTE_ACCESS.PROTECTED,
      ),
    ).toHaveLength(128);
  });
});

import { RequestMethod, type Type } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import {
  AUTH_ROUTE_ACCESS,
  type AuthRouteAccess,
  OPTIONAL_SESSION_ROUTE_METADATA,
  PROTECTED_ROUTE_METADATA,
  PUBLIC_ROUTE_METADATA,
} from './auth-route-metadata';
import { SessionGuard } from './session.guard';

export type ControllerType = Type<unknown>;

export interface AuthRouteManifestEntry {
  readonly method: string;
  readonly path: string;
  readonly access: AuthRouteAccess;
}

interface AccessMetadata {
  readonly access: AuthRouteAccess;
  readonly key: symbol;
}

const ACCESS_METADATA: readonly AccessMetadata[] = [
  {
    access: AUTH_ROUTE_ACCESS.PUBLIC,
    key: PUBLIC_ROUTE_METADATA,
  },
  {
    access: AUTH_ROUTE_ACCESS.OPTIONAL_SESSION,
    key: OPTIONAL_SESSION_ROUTE_METADATA,
  },
  {
    access: AUTH_ROUTE_ACCESS.PROTECTED,
    key: PROTECTED_ROUTE_METADATA,
  },
];

export function createAuthRouteManifest(
  controllers: readonly ControllerType[],
  globalPrefix = 'api/v1',
): AuthRouteManifestEntry[] {
  const manifest = controllers.flatMap((controller) =>
    controllerRoutes(controller, globalPrefix),
  );
  const routeKeys = new Set<string>();

  for (const route of manifest) {
    const key = routeKey(route);
    if (routeKeys.has(key)) {
      throw new Error(
        `Duplicate HTTP route in authentication manifest: ${key}`,
      );
    }
    routeKeys.add(key);
  }

  return manifest.sort((left, right) =>
    routeKey(left).localeCompare(routeKey(right)),
  );
}

function routeKey(route: AuthRouteManifestEntry): string {
  return `${route.method} ${route.path}`;
}

function controllerRoutes(
  controller: ControllerType,
  globalPrefix: string,
): AuthRouteManifestEntry[] {
  const controllerPaths = metadataPaths(controller) ?? [''];
  const classAccess = ownAccessMetadata(controller);
  const prototype = controller.prototype as Record<string, unknown>;

  return Object.getOwnPropertyNames(prototype).flatMap((propertyName) => {
    if (propertyName === 'constructor') {
      return [];
    }
    const handler = prototype[propertyName];
    if (typeof handler !== 'function') {
      return [];
    }
    const requestMethod = Reflect.getOwnMetadata(METHOD_METADATA, handler) as
      RequestMethod | undefined;
    if (requestMethod === undefined) {
      return [];
    }

    const handlerAccess = ownAccessMetadata(handler);
    const declaredAccess =
      handlerAccess.length > 0 ? handlerAccess : classAccess;
    const effectiveAccess =
      declaredAccess.length > 0
        ? declaredAccess
        : sessionGuardAccess(controller, handler);
    const access = requireSingleAccessMetadata(
      effectiveAccess,
      `${controller.name}.${propertyName}`,
    );
    const handlerPaths = metadataPaths(handler) ?? [''];

    return controllerPaths.flatMap((controllerPath) =>
      handlerPaths.map((handlerPath) => ({
        method: requestMethodName(requestMethod),
        path: joinRoutePath(globalPrefix, controllerPath, handlerPath),
        access,
      })),
    );
  });
}

function sessionGuardAccess(
  controller: ControllerType,
  handler: object,
): AuthRouteAccess[] {
  const guards = [...metadataGuards(controller), ...metadataGuards(handler)];
  return guards.includes(SessionGuard) ? [AUTH_ROUTE_ACCESS.PROTECTED] : [];
}

function metadataGuards(target: object): unknown[] {
  return (
    (Reflect.getOwnMetadata(GUARDS_METADATA, target) as
      unknown[] | undefined) ?? []
  );
}

function ownAccessMetadata(target: object): AuthRouteAccess[] {
  return ACCESS_METADATA.filter(({ key }) =>
    Reflect.getOwnMetadata(key, target),
  ).map(({ access }) => access);
}

function requireSingleAccessMetadata(
  accesses: readonly AuthRouteAccess[],
  handlerName: string,
): AuthRouteAccess {
  if (accesses.length === 0) {
    throw new Error(`Missing authentication metadata: ${handlerName}`);
  }
  if (accesses.length > 1) {
    throw new Error(`Duplicate authentication metadata: ${handlerName}`);
  }
  return accesses[0]!;
}

function metadataPaths(target: object): string[] | undefined {
  const paths = Reflect.getOwnMetadata(PATH_METADATA, target) as
    string | string[] | undefined;
  if (paths === undefined) {
    return undefined;
  }
  return Array.isArray(paths) ? paths : [paths];
}

function requestMethodName(requestMethod: RequestMethod): string {
  const name = RequestMethod[requestMethod];
  if (name === undefined) {
    throw new Error(`Unknown Nest request method: ${requestMethod}`);
  }
  return name;
}

function joinRoutePath(...segments: string[]): string {
  const path = segments
    .flatMap((segment) => segment.split('/'))
    .filter(Boolean)
    .join('/');
  return `/${path}`;
}

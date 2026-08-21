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
  const classLocation = `${controller.name} class`;
  const classAccess = requireValidAccessMetadata(controller, classLocation);
  const classHasSessionGuard = hasSessionGuard(controller);
  requireConsistentSessionGuard(
    classAccess,
    classHasSessionGuard,
    classLocation,
  );
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

    const handlerLocation = `${controller.name}.${propertyName} handler`;
    const handlerAccess = requireValidAccessMetadata(handler, handlerLocation);
    const handlerHasSessionGuard = hasSessionGuard(handler);
    requireConsistentSessionGuard(
      handlerAccess,
      handlerHasSessionGuard,
      handlerLocation,
    );
    const declaredAccess =
      handlerAccess.length > 0 ? handlerAccess : classAccess;
    const hasEffectiveSessionGuard =
      classHasSessionGuard || handlerHasSessionGuard;
    let effectiveAccess = declaredAccess;
    if (effectiveAccess.length === 0 && hasEffectiveSessionGuard) {
      effectiveAccess = [AUTH_ROUTE_ACCESS.PROTECTED];
    }
    const access = requireSingleAccessMetadata(
      effectiveAccess,
      `${controller.name}.${propertyName}`,
    );
    if (hasEffectiveSessionGuard && access !== AUTH_ROUTE_ACCESS.PROTECTED) {
      throw new Error(
        `Conflicting authentication metadata and SessionGuard: ${controller.name}.${propertyName}`,
      );
    }
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

function hasSessionGuard(target: object): boolean {
  return metadataGuards(target).includes(SessionGuard);
}

function metadataGuards(target: object): unknown[] {
  return (
    (Reflect.getOwnMetadata(GUARDS_METADATA, target) as
      unknown[] | undefined) ?? []
  );
}

function requireValidAccessMetadata(
  target: object,
  location: string,
): AuthRouteAccess[] {
  const accesses: AuthRouteAccess[] = [];
  for (const { access, key } of ACCESS_METADATA) {
    if (!Reflect.hasOwnMetadata(key, target)) {
      continue;
    }
    if (Reflect.getOwnMetadata(key, target) !== true) {
      throw new Error(`Invalid authentication metadata: ${location}`);
    }
    accesses.push(access);
  }
  if (accesses.length > 1) {
    throw new Error(`Duplicate authentication metadata: ${location}`);
  }
  return accesses;
}

function requireConsistentSessionGuard(
  accesses: readonly AuthRouteAccess[],
  hasGuard: boolean,
  location: string,
): void {
  const [access] = accesses;
  if (
    hasGuard &&
    access !== undefined &&
    access !== AUTH_ROUTE_ACCESS.PROTECTED
  ) {
    throw new Error(
      `Conflicting authentication metadata and SessionGuard: ${location}`,
    );
  }
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

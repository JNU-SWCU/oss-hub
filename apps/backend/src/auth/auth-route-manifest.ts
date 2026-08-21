import { RequestMethod, type Type } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { MetadataScanner } from '@nestjs/core/metadata-scanner';
import { compareStringsByCodeUnit } from '../deterministic-string-order';
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

interface ControllerAuthState {
  readonly declaredAccess: AuthRouteAccess | undefined;
  readonly hasSessionGuard: boolean;
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
const metadataScanner = new MetadataScanner();

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
    compareStringsByCodeUnit(routeKey(left), routeKey(right)),
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
  const controllerAuthState: ControllerAuthState = {
    declaredAccess: requireValidAccessMetadata(
      controller,
      `${controller.name} class`,
    ),
    hasSessionGuard: hasSessionGuard(controller),
  };
  const prototypeValue: unknown = controller.prototype;
  if (typeof prototypeValue !== 'object' || prototypeValue === null) {
    throw new Error(`Invalid controller prototype: ${controller.name}`);
  }
  const prototype = prototypeValue;

  return metadataScanner
    .getAllMethodNames(prototype)
    .flatMap((propertyName) => {
      const handler: unknown = Reflect.get(prototype, propertyName);
      if (typeof handler !== 'function') {
        return [];
      }
      const requestMethod = Reflect.getMetadata(METHOD_METADATA, handler) as
        RequestMethod | undefined;
      if (requestMethod === undefined) {
        return [];
      }

      const handlerName = `${controller.name}.${propertyName}`;
      const access = resolveHandlerAccess(
        handler,
        handlerName,
        controllerAuthState,
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

function hasSessionGuard(target: object): boolean {
  const guards =
    (Reflect.getMetadata(GUARDS_METADATA, target) as unknown[] | undefined) ??
    [];
  return guards.includes(SessionGuard);
}

function requireValidAccessMetadata(
  target: object,
  location: string,
): AuthRouteAccess | undefined {
  const accesses: AuthRouteAccess[] = [];
  for (const { access, key } of ACCESS_METADATA) {
    if (!Reflect.hasMetadata(key, target)) {
      continue;
    }
    if (Reflect.getMetadata(key, target) !== true) {
      throw new Error(`Invalid authentication metadata: ${location}`);
    }
    accesses.push(access);
  }
  if (accesses.length > 1) {
    throw new Error(`Duplicate authentication metadata: ${location}`);
  }
  return accesses.length === 1 ? accesses[0] : undefined;
}

function resolveHandlerAccess(
  handler: object,
  handlerName: string,
  controllerAuthState: ControllerAuthState,
): AuthRouteAccess {
  const handlerAccess = requireValidAccessMetadata(
    handler,
    `${handlerName} handler`,
  );
  const declaredAccess = handlerAccess ?? controllerAuthState.declaredAccess;
  if (declaredAccess !== undefined) {
    return declaredAccess;
  }
  if (controllerAuthState.hasSessionGuard || hasSessionGuard(handler)) {
    return AUTH_ROUTE_ACCESS.PROTECTED;
  }
  throw new Error(`Missing authentication metadata: ${handlerName}`);
}

function metadataPaths(target: object): string[] | undefined {
  const paths = Reflect.getMetadata(PATH_METADATA, target) as
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

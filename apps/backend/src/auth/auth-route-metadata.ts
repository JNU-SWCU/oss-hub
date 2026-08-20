import { SetMetadata } from '@nestjs/common';

export const AUTH_ROUTE_ACCESS = {
  PUBLIC: 'PUBLIC',
  OPTIONAL_SESSION: 'OPTIONAL_SESSION',
  PROTECTED: 'PROTECTED',
} as const;

export type AuthRouteAccess =
  (typeof AUTH_ROUTE_ACCESS)[keyof typeof AUTH_ROUTE_ACCESS];

export const PUBLIC_ROUTE_METADATA = Symbol('public-route');
export const OPTIONAL_SESSION_ROUTE_METADATA = Symbol('optional-session-route');
export const PROTECTED_ROUTE_METADATA = Symbol('protected-route');

type AuthRouteDecorator = ClassDecorator & MethodDecorator;

export function Public(): AuthRouteDecorator {
  return SetMetadata(PUBLIC_ROUTE_METADATA, true);
}

export function OptionalSession(): AuthRouteDecorator {
  return SetMetadata(OPTIONAL_SESSION_ROUTE_METADATA, true);
}

export function Protected(): AuthRouteDecorator {
  return SetMetadata(PROTECTED_ROUTE_METADATA, true);
}

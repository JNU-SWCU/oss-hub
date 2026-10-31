import type { CanActivate, ExecutionContext, Provider } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import {
  AuthenticationGuard,
  OPTIONAL_SESSION_ROUTE_METADATA,
  PUBLIC_ROUTE_METADATA,
} from '../src/auth/authentication.guard';

export const GLOBAL_AUTHENTICATION_GUARD_PROVIDERS = [
  AuthenticationGuard,
  { provide: APP_GUARD, useExisting: AuthenticationGuard },
];

const reflector = new Reflector();

export function protectedRouteGuardStub(guard: CanActivate): Provider {
  return {
    provide: APP_GUARD,
    useValue: {
      canActivate(context: ExecutionContext) {
        const targets = [context.getHandler(), context.getClass()];
        const anonymousAllowed = [
          PUBLIC_ROUTE_METADATA,
          OPTIONAL_SESSION_ROUTE_METADATA,
        ].some(
          (key) => reflector.getAllAndOverride<boolean>(key, targets) === true,
        );
        return anonymousAllowed || guard.canActivate(context);
      },
    },
  };
}

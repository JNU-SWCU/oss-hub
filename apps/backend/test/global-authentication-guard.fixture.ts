import type { CanActivate, ExecutionContext, Provider } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { AccountStatus } from '@prisma/client';
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

interface SessionActorFacts {
  readonly id?: string;
  readonly githubId?: bigint;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
  readonly accountStatus: AccountStatus | null;
}

export function sessionPrincipal(actor: SessionActorFacts | null) {
  const active = actor?.accountStatus === AccountStatus.ACTIVE;
  return {
    id: actor?.id ?? 'synthetic-actor',
    githubId: actor?.githubId,
    sessionVersion: 0,
    accountStatus: actor?.accountStatus ?? null,
    hasStaffAccess: active && actor.hasStaffAccess,
    hasAdminAccess: active && actor.hasAdminAccess,
  };
}

export const SYNTHETIC_STAFF_PRINCIPAL = sessionPrincipal({
  id: 'synthetic-staff',
  hasStaffAccess: true,
  hasAdminAccess: false,
  accountStatus: AccountStatus.ACTIVE,
});

export async function databaseSessionPrincipal(
  prisma: {
    readonly user: {
      findUnique(args: {
        where: { githubId: bigint };
        select: {
          id: true;
          hasStaffAccess: true;
          hasAdminAccess: true;
          accountStatus: true;
        };
      }): PromiseLike<Omit<SessionActorFacts, 'githubId'> | null>;
    };
  },
  githubId: bigint,
) {
  const user = await prisma.user.findUnique({
    where: { githubId },
    select: {
      id: true,
      hasStaffAccess: true,
      hasAdminAccess: true,
      accountStatus: true,
    },
  });
  return sessionPrincipal(user === null ? null : { ...user, githubId });
}

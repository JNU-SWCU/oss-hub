import type { PrismaService } from '../src/platform/prisma.service';
import type { ActiveAccountPrincipal } from '../src/auth/http-auth.types';
import { USER_AUTHORITY_SELECT } from '../src/platform/user-profile-read.config';
import { UserProfileService } from '../src/users/user-profile.service';
import { DomainException } from '../src/platform/error-code.error';
import {
  AUTH_ERROR_CODES,
  AuthErrorCode,
} from '../src/auth/auth-error-code.error';
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
  prisma: Pick<PrismaService, 'user'>,
  githubId: bigint,
): Promise<ActiveAccountPrincipal> {
  const user = await prisma.user.findUnique({
    where: { githubId },
    select: {
      id: true,
      githubId: true,
      nickname: true,
      avatarUrl: true,
      accountStatus: true,
      sessionVersion: true,
      ...USER_AUTHORITY_SELECT,
    },
  });
  if (user === null || user.accountStatus !== AccountStatus.ACTIVE)
    throw new DomainException(AUTH_ERROR_CODES[AuthErrorCode.UNAUTHENTICATED]);
  const profileService = new UserProfileService();
  const memberKind = user.type === 'UNSELECTED' ? null : user.type;
  return {
    id: user.id,
    githubId: user.githubId,
    nickname: user.nickname,
    name: user.name,
    avatarUrl: user.avatarUrl,
    accountStatus: AccountStatus.ACTIVE,
    sessionVersion: user.sessionVersion,
    memberKind,
    hasAdminAccess: user.admin !== null,
    hasStaffAccess: profileService.hasStaffAccess({ ...user, memberKind }),
    isProfileComplete:
      user.profileCreatedAt !== null &&
      memberKind !== null &&
      profileService.isCompleteProfileFields(user, memberKind),
  };
}

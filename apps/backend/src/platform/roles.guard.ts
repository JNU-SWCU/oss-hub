import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from '../auth/http-auth.types';

const ROLE = {
  STAFF: 'STAFF',
  ADMIN: 'ADMIN',
} as const;

export type Role = (typeof ROLE)[keyof typeof ROLE];

export const STAFF_AUDIENCE: readonly Role[] = [ROLE.STAFF, ROLE.ADMIN];

export const ADMIN_AUDIENCE: readonly Role[] = [ROLE.ADMIN];

export const ROLES_METADATA = Symbol('required-roles');

export interface RolesRequirement {
  readonly roles: readonly Role[];
  readonly forbidden: () => Error;
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const { roles, forbidden } = this.reflector.get<RolesRequirement>(
      ROLES_METADATA,
      context.getHandler(),
    );
    const { principal } = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>();
    const granted = roles.some((role) =>
      role === ROLE.ADMIN ? principal.hasAdminAccess : principal.hasStaffAccess,
    );
    if (!granted) {
      throw forbidden();
    }
    return true;
  }
}

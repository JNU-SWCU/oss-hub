import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import {
  type Role,
  ROLES_METADATA,
  RolesGuard,
  type RolesRequirement,
} from './roles.guard';

export function Roles(
  roles: readonly Role[],
  forbidden: () => Error,
): MethodDecorator {
  const requirement: RolesRequirement = { roles, forbidden };
  return applyDecorators(
    SetMetadata(ROLES_METADATA, requirement),
    UseGuards(RolesGuard),
  );
}

import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import {
  ADMIN_AUDIENCE,
  Roles,
  RolesGuard,
  ROLES_METADATA,
  STAFF_AUDIENCE,
} from './roles.guard';

const forbidden = () => new ForbiddenException('synthetic forbidden');

class SyntheticController {
  @Roles(STAFF_AUDIENCE, forbidden)
  staffRoute(this: void): void {}

  @Roles(ADMIN_AUDIENCE, forbidden)
  adminRoute(this: void): void {}
}

function contextFor(
  handler: () => void,
  principal: { hasStaffAccess: boolean; hasAdminAccess: boolean },
): ExecutionContext {
  return {
    getHandler: () => handler,
    switchToHttp: () => ({ getRequest: () => ({ principal }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());
  const handlers = SyntheticController.prototype;

  it.each([
    ['staff', true, false, true, false],
    ['admin without staff', false, true, true, true],
    ['admin with staff', true, true, true, true],
    ['student', false, false, false, false],
  ])(
    '%s is decided from the request principal',
    (_label, hasStaffAccess, hasAdminAccess, staffRoute, adminRoute) => {
      const principal = { hasStaffAccess, hasAdminAccess };
      const decide = (handler: () => void, granted: boolean) => {
        const run = () => guard.canActivate(contextFor(handler, principal));
        if (granted) {
          expect(run()).toBe(true);
        } else {
          expect(run).toThrow('synthetic forbidden');
        }
      };
      decide(handlers.staffRoute, staffRoute);
      decide(handlers.adminRoute, adminRoute);
    },
  );

  it('binds the guard together with the metadata', () => {
    expect(Reflect.getMetadata(ROLES_METADATA, handlers.staffRoute)).toEqual({
      roles: STAFF_AUDIENCE,
      forbidden,
    });
    expect(Reflect.getMetadata(GUARDS_METADATA, handlers.staffRoute)).toEqual([
      RolesGuard,
    ]);
  });
});

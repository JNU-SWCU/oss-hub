import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { OriginGuard } from '../auth/origin.guard';
import { SessionGuard } from '../auth/session.guard';
import {
  ADMIN_ACCESS_COMMANDS,
  STAFF_ACCESS_COMMANDS,
} from './domain/independent-authority';
import {
  PatchAdminAuthorityRequestDto,
  PatchStaffAccessRequestDto,
} from './dto/patch-independent-authority.dto';
import { IndependentAuthorityController } from './independent-authority.controller';
import type { IndependentAuthorityService } from './independent-authority.service';

const request = { sessionGithubId: 9_700_300_001n };

it.each([
  ['patchStaffAccess', ':id/staff-access'],
  ['patchAdminAccess', ':id/admin-access'],
] as const)('%s owns its PATCH route and write guards', (method, path) => {
  const handler: unknown = Object.getOwnPropertyDescriptor(
    IndependentAuthorityController.prototype,
    method,
  )?.value;
  expect(typeof handler).toBe('function');
  if (typeof handler !== 'function') {
    throw new TypeError(`Missing IndependentAuthorityController.${method}`);
  }
  expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
    RequestMethod.PATCH,
  );
  expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
  expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([
    SessionGuard,
    OriginGuard,
  ]);
});

it('delegates typed staff and admin commands independently', async () => {
  const service = {
    patchStaffAccess: jest.fn().mockResolvedValue(result()),
    patchAdminAccess: jest.fn().mockResolvedValue(result()),
  } satisfies Pick<
    IndependentAuthorityService,
    'patchStaffAccess' | 'patchAdminAccess'
  >;
  const controller = new IndependentAuthorityController(service);
  const staffBody = Object.assign(new PatchStaffAccessRequestDto(), {
    command: STAFF_ACCESS_COMMANDS.GRANT,
  });
  const adminBody = Object.assign(new PatchAdminAuthorityRequestDto(), {
    command: ADMIN_ACCESS_COMMANDS.REVOKE,
  });

  await controller.patchStaffAccess(request, 'target', staffBody);
  await controller.patchAdminAccess(request, 'target', adminBody);

  expect(service.patchStaffAccess).toHaveBeenCalledWith(
    request.sessionGithubId,
    'target',
    { command: STAFF_ACCESS_COMMANDS.GRANT },
  );
  expect(service.patchAdminAccess).toHaveBeenCalledWith(
    request.sessionGithubId,
    'target',
    { command: ADMIN_ACCESS_COMMANDS.REVOKE },
  );
});

function result() {
  return {
    id: 'target',
    role: null,
    memberKind: null,
    hasStaffAccess: false,
    hasAdminAccess: false,
  };
}

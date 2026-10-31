import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { AccountStatus } from '@prisma/client';
import { OriginGuard } from '../platform/origin.guard';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { RolesErrorCode } from '../users/roles-error-code.error';
import { UserAccessController } from './user-access.controller';
import { AdminAccessService } from '../users/admin-access.service';
import type { AdminProfileService } from '../users/admin-profile.service';
import { AdminAccessListRequestDto } from './dto/admin-access-list-request.dto';
import { PatchAdminAccessRequestDto } from './dto/patch-admin-access-request.dto';
import type { PatchAdminUserProfileRequestDto } from './dto/patch-admin-user-profile-request.dto';
import { PatchIndependentAuthorityRequestDto } from './dto/patch-independent-authority-request.dto';
import { IndependentAuthorityService } from '../users/independent-authority.service';
import { MemberKindService } from '../users/member-kind.service';
import { ADMIN_ACCESS_COMMANDS } from '../users/admin-access-query.config';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';
import { UserProfileService } from '../platform/user-profile.service';
import { AdminAccessMutationService } from '../users/admin-access-mutation.service';

describe('admin-access.controller', () => {
  const REQUEST: Pick<AuthenticatedRequest, 'sessionGithubId'> = {
    sessionGithubId: 9_131_400_001n,
  };

  describe('UserAccessController routes', () => {
    it.each([
      ['list', RequestMethod.GET, 'access', undefined],
      ['facets', RequestMethod.GET, 'access/facets', undefined],
      ['patchAccess', RequestMethod.PATCH, ':id/access', [OriginGuard]],
      ['patchProfile', RequestMethod.PATCH, ':id/profile', [OriginGuard]],
    ] as const)(
      '%s owns the fixed method/path/guard contract',
      (name, method, path, guards) => {
        const handler: unknown = Object.getOwnPropertyDescriptor(
          UserAccessController.prototype,
          name,
        )?.value;
        expect(typeof handler).toBe('function');
        if (typeof handler !== 'function') {
          throw new TypeError(`Missing UserAccessController.${name}`);
        }
        expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(method);
        expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
        expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual(guards);
      },
    );

    it('uses the users resource prefix', () => {
      expect(Reflect.getMetadata(PATH_METADATA, UserAccessController)).toBe(
        'users',
      );
    });
  });

  describe('UserAccessController delegation', () => {
    it.each([
      ['name', 'asc'],
      ['createdAt', 'desc'],
      ['lastLoginAt', 'asc'],
      ['role', 'desc'],
      ['accountStatus', 'asc'],
    ] as const)(
      'passes sort=%s&direction=%s to the service',
      async (sort, direction) => {
        const service = serviceHarness();
        const profileService = profileServiceHarness();
        const controller = new UserAccessController(
          service,
          profileService,
          authorityServiceHarness(),
          memberKindServiceHarness(),
          new AdminAccessMutationService(
            new AuditLogMetadataService(),
            new UserProfileService(),
          ),
        );
        const query = Object.assign(new AdminAccessListRequestDto(), {
          sort,
          direction,
        });

        await controller.list(REQUEST, query);

        expect(service.list).toHaveBeenCalledWith(REQUEST.sessionGithubId, {
          query: '',
          page: 1,
          limit: 20,
          sort,
          direction,
        });
      },
    );

    it('passes the parsed CAS command to PATCH /users/:id/access', async () => {
      const service = serviceHarness();
      const profileService = profileServiceHarness();
      const controller = new UserAccessController(
        service,
        profileService,
        authorityServiceHarness(),
        memberKindServiceHarness(),
        new AdminAccessMutationService(
          new AuditLogMetadataService(),
          new UserProfileService(),
        ),
      );
      const command = {
        expectedRole: 'STUDENT',
        desiredRole: 'STAFF',
        expectedAccountStatus: AccountStatus.ACTIVE,
        desiredAccountStatus: AccountStatus.ACTIVE,
        expectedPendingRequest: null,
      } as const;
      const body = Object.assign(new PatchAdminAccessRequestDto(), command);

      await controller.patchAccess(REQUEST, 'target-user', body);

      expect(service.patchAccess).toHaveBeenCalledWith(
        REQUEST.sessionGithubId,
        'target-user',
        command,
      );
    });

    it('passes the parsed command to PATCH /users/:id/profile', async () => {
      const service = serviceHarness();
      const profileService = profileServiceHarness();
      const controller = new UserAccessController(
        service,
        profileService,
        authorityServiceHarness(),
        memberKindServiceHarness(),
        new AdminAccessMutationService(
          new AuditLogMetadataService(),
          new UserProfileService(),
        ),
      );
      const command = {
        name: '테스트관리자',
        studentId: '260001',
        department: '컴퓨터공학과',
      } as const;
      const body = {
        toCommand: () => command,
      } as PatchAdminUserProfileRequestDto;

      await controller.patchProfile(REQUEST, 'target-user', body);

      expect(profileService.patchProfile).toHaveBeenCalledWith(
        REQUEST.sessionGithubId,
        'target-user',
        command,
      );
    });

    it('patchAccess rejects an invalid user id before service delegation', async () => {
      const service = serviceHarness();
      const profileService = profileServiceHarness();
      const controller = new UserAccessController(
        service,
        profileService,
        authorityServiceHarness(),
        memberKindServiceHarness(),
        new AdminAccessMutationService(
          new AuditLogMetadataService(),
          new UserProfileService(),
        ),
      );
      const body = {
        toCommand: jest.fn(),
      } as unknown as PatchAdminAccessRequestDto;

      const operation = controller.patchAccess(REQUEST, 'invalid id', body);

      await expect(operation).rejects.toMatchObject({
        errorCode: { code: RolesErrorCode.INVALID_USER_ID, status: 400 },
      });
      expect(service.patchAccess).not.toHaveBeenCalled();
    });

    it('patchProfile rejects an invalid user id before service delegation', async () => {
      const service = serviceHarness();
      const profileService = profileServiceHarness();
      const controller = new UserAccessController(
        service,
        profileService,
        authorityServiceHarness(),
        memberKindServiceHarness(),
        new AdminAccessMutationService(
          new AuditLogMetadataService(),
          new UserProfileService(),
        ),
      );
      const body = {
        toCommand: jest.fn(),
      } as unknown as PatchAdminUserProfileRequestDto;

      const operation = controller.patchProfile(REQUEST, 'invalid id', body);

      await expect(operation).rejects.toMatchObject({
        errorCode: { code: RolesErrorCode.INVALID_USER_ID, status: 400 },
      });
      expect(profileService.patchProfile).not.toHaveBeenCalled();
    });

    it.each(['patchAccess', 'patchProfile'] as const)(
      "%s rejects the reserved 'me' id even if it reaches this controller(#787)",
      async (method) => {
        const service = serviceHarness();
        const profileService = profileServiceHarness();
        const controller = new UserAccessController(
          service,
          profileService,
          authorityServiceHarness(),
          memberKindServiceHarness(),
          new AdminAccessMutationService(
            new AuditLogMetadataService(),
            new UserProfileService(),
          ),
        );
        const body = {
          toCommand: jest.fn(),
        } as unknown as PatchAdminAccessRequestDto &
          PatchAdminUserProfileRequestDto;

        const operation =
          method === 'patchAccess'
            ? controller.patchAccess(REQUEST, 'me', body)
            : controller.patchProfile(REQUEST, 'me', body);

        await expect(operation).rejects.toMatchObject({
          errorCode: { code: RolesErrorCode.INVALID_USER_ID, status: 400 },
        });
        if (method === 'patchProfile') {
          expect(profileService.patchProfile).not.toHaveBeenCalled();
        } else {
          expect(service.patchAccess).not.toHaveBeenCalled();
        }
      },
    );
  });

  function serviceHarness() {
    return {
      list: jest.fn().mockResolvedValue({
        items: [],
        page: 1,
        limit: 20,
        total: 0,
        facets: emptyFacets(),
      }),
      facets: jest.fn().mockResolvedValue(emptyFacets()),
      patchAccess: jest.fn().mockResolvedValue({}),
    } satisfies Pick<AdminAccessService, 'list' | 'facets' | 'patchAccess'>;
  }

  function profileServiceHarness() {
    return {
      patchProfile: jest.fn().mockResolvedValue({
        id: 'target-user',
        name: null,
        studentId: null,
        department: null,
      }),
    } satisfies Pick<AdminProfileService, 'patchProfile'>;
  }

  function emptyFacets() {
    return {
      roles: { unassigned: 0, student: 0, staff: 0, admin: 0 },
      accountStatuses: { active: 0, deactivated: 0 },
      pendingRequests: { none: 0, pending: 0 },
    };
  }
});

describe('independent-authority.controller', () => {
  const request = { sessionGithubId: 9_700_300_001n };

  it.each([['patchAdminAccess', ':id/admin-access']] as const)(
    '%s owns its PATCH route and write guards',
    (method, path) => {
      const handler: unknown = Object.getOwnPropertyDescriptor(
        UserAccessController.prototype,
        method,
      )?.value;
      expect(typeof handler).toBe('function');
      if (typeof handler !== 'function') {
        throw new TypeError(`Missing UserAccessController.${method}`);
      }
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
        RequestMethod.PATCH,
      );
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([
        OriginGuard,
      ]);
    },
  );

  it('delegates the typed admin command', async () => {
    const service = Object.assign(authorityServiceHarness(), {
      patchAdminAccess: jest.fn().mockResolvedValue(result()),
    });
    const controller = new UserAccessController(
      { list: jest.fn(), facets: jest.fn(), patchAccess: jest.fn() },
      { patchProfile: jest.fn() },
      service,
      memberKindServiceHarness(),
      new AdminAccessMutationService(
        new AuditLogMetadataService(),
        new UserProfileService(),
      ),
    );
    const adminBody = Object.assign(new PatchIndependentAuthorityRequestDto(), {
      command: ADMIN_ACCESS_COMMANDS.REVOKE,
    });

    await controller.patchAdminAccess(request, 'target', adminBody);

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
});

function authorityServiceHarness() {
  return Object.assign(
    Object.create(
      IndependentAuthorityService.prototype,
    ) as IndependentAuthorityService,
    { patchAdminAccess: jest.fn() },
  );
}

function memberKindServiceHarness() {
  return Object.assign(
    Object.create(MemberKindService.prototype) as MemberKindService,
    { patchMemberKind: jest.fn() },
  );
}

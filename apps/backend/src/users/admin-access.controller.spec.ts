import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { AccountStatus, Role } from '@prisma/client';
import { OriginGuard } from '../auth/origin.guard';
import type { AuthenticatedRequest } from '../auth/session.guard';
import { SessionGuard } from '../auth/session.guard';
import { RolesErrorCode } from '../roles/roles-error-code.enum';
import { AdminAccessController } from './admin-access.controller';
import { AdminAccessService } from './admin-access.service';
import {
  AdminAccessHistoryRequestDto,
  AdminAccessListRequestDto,
} from './dto/admin-access-query.dto';
import type { PatchAdminAccessRequestDto } from './dto/patch-admin-access.dto';

const REQUEST: Pick<AuthenticatedRequest, 'sessionGithubId'> = {
  sessionGithubId: 9_131_400_001n,
};

describe('AdminAccessController routes', () => {
  it.each([
    ['list', RequestMethod.GET, 'access', [SessionGuard]],
    ['facets', RequestMethod.GET, 'access/facets', [SessionGuard]],
    ['get', RequestMethod.GET, ':id/access', [SessionGuard]],
    ['getHistory', RequestMethod.GET, ':id/access/history', [SessionGuard]],
    [
      'patchAccess',
      RequestMethod.PATCH,
      ':id/access',
      [SessionGuard, OriginGuard],
    ],
  ] as const)(
    '%s owns the fixed method/path/guard contract',
    (name, method, path, guards) => {
      const handler: unknown = Object.getOwnPropertyDescriptor(
        AdminAccessController.prototype,
        name,
      )?.value;
      expect(typeof handler).toBe('function');
      if (typeof handler !== 'function') {
        throw new TypeError(`Missing AdminAccessController.${name}`);
      }
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(method);
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual(guards);
    },
  );

  it('uses the users resource prefix', () => {
    expect(Reflect.getMetadata(PATH_METADATA, AdminAccessController)).toBe(
      'users',
    );
  });
});

describe('AdminAccessController delegation', () => {
  it.each([
    ['name', 'asc'],
    ['createdAt', 'desc'],
    ['lastLoginAt', 'asc'],
  ] as const)(
    'passes sort=%s&direction=%s to the service',
    async (sort, direction) => {
      // Given
      const service = serviceHarness();
      const controller = new AdminAccessController(service);
      const query = Object.assign(new AdminAccessListRequestDto(), {
        sort,
        direction,
      });

      // When
      await controller.list(REQUEST, query);

      // Then
      expect(service.list).toHaveBeenCalledWith(REQUEST.sessionGithubId, {
        query: '',
        page: 1,
        limit: 20,
        sort,
        direction,
      });
    },
  );

  it('passes independent history pages to the service', async () => {
    // Given
    const service = serviceHarness();
    const controller = new AdminAccessController(service);
    const query = Object.assign(new AdminAccessHistoryRequestDto(), {
      roleRequestPage: 2,
      roleRequestLimit: 5,
      loginPage: 3,
      loginLimit: 10,
    });

    // When
    await controller.getHistory(REQUEST, 'target-user', query);

    // Then
    expect(service.getHistory).toHaveBeenCalledWith(
      REQUEST.sessionGithubId,
      'target-user',
      {
        roleRequests: { page: 2, limit: 5 },
        loginHistory: { page: 3, limit: 10 },
      },
    );
  });

  it('passes the parsed CAS command to PATCH /users/:id/access', async () => {
    // Given
    const service = serviceHarness();
    const controller = new AdminAccessController(service);
    const command = {
      expectedRole: Role.STUDENT,
      desiredRole: Role.STAFF,
      expectedAccountStatus: AccountStatus.ACTIVE,
      desiredAccountStatus: AccountStatus.ACTIVE,
      expectedPendingRequest: null,
    } as const;
    const body = { toCommand: () => command } as PatchAdminAccessRequestDto;

    // When
    await controller.patchAccess(REQUEST, 'target-user', body);

    // Then
    expect(service.patchAccess).toHaveBeenCalledWith(
      REQUEST.sessionGithubId,
      'target-user',
      command,
    );
  });

  it.each(['get', 'getHistory', 'patchAccess'] as const)(
    '%s rejects an invalid user id before service delegation',
    async (method) => {
      // Given
      const service = serviceHarness();
      const controller = new AdminAccessController(service);
      const query = new AdminAccessHistoryRequestDto();
      const body = {
        toCommand: jest.fn(),
      } as unknown as PatchAdminAccessRequestDto;

      // When
      const operation =
        method === 'get'
          ? controller.get(REQUEST, 'invalid id')
          : method === 'getHistory'
            ? controller.getHistory(REQUEST, 'invalid id', query)
            : controller.patchAccess(REQUEST, 'invalid id', body);

      // Then
      await expect(operation).rejects.toMatchObject({
        errorCode: { code: RolesErrorCode.INVALID_USER_ID, status: 400 },
      });
      expect(service[method]).not.toHaveBeenCalled();
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
    get: jest.fn().mockResolvedValue({}),
    getHistory: jest.fn().mockResolvedValue({
      roleRequests: { items: [], page: 1, limit: 20, total: 0 },
      loginHistory: { items: [], page: 1, limit: 20, total: 0 },
    }),
    patchAccess: jest.fn().mockResolvedValue({}),
  } satisfies Pick<
    AdminAccessService,
    'list' | 'facets' | 'get' | 'getHistory' | 'patchAccess'
  >;
}

function emptyFacets() {
  return {
    roles: { unassigned: 0, student: 0, staff: 0, admin: 0 },
    accountStatuses: { active: 0, deactivated: 0 },
    pendingRequests: { none: 0, pending: 0 },
  };
}

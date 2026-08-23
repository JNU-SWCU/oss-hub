import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { AccountStatus } from '@prisma/client';
import { OriginGuard } from '../auth/origin.guard';
import type { AuthenticatedRequest } from '../auth/session.guard';
import { SessionGuard } from '../auth/session.guard';
import { RolesErrorCode } from '../roles/roles-error-code.enum';
import { AdminAccessController } from './admin-access.controller';
import { AdminAccessService } from './admin-access.service';
import type { AdminProfileService } from './admin-profile.service';
import {
  AdminAccessHistoryRequestDto,
  AdminAccessListRequestDto,
} from './dto/admin-access-query.dto';
import type { PatchAdminAccessRequestDto } from './dto/patch-admin-access.dto';
import type { PatchAdminUserProfileRequestDto } from './dto/patch-admin-user-profile.dto';

const REQUEST: Pick<AuthenticatedRequest, 'sessionGithubId'> = {
  sessionGithubId: 9_131_400_001n,
};

describe('AdminAccessController routes', () => {
  it.each([
    ['list', RequestMethod.GET, 'access', [SessionGuard]],
    ['listRequests', RequestMethod.GET, 'access/requests', [SessionGuard]],
    ['facets', RequestMethod.GET, 'access/facets', [SessionGuard]],
    ['get', RequestMethod.GET, ':id/access', [SessionGuard]],
    ['getHistory', RequestMethod.GET, ':id/access/history', [SessionGuard]],
    [
      'patchAccess',
      RequestMethod.PATCH,
      ':id/access',
      [SessionGuard, OriginGuard],
    ],
    [
      'patchProfile',
      RequestMethod.PATCH,
      ':id/profile',
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
    ['role', 'desc'],
    ['accountStatus', 'asc'],
  ] as const)(
    'passes sort=%s&direction=%s to the service',
    async (sort, direction) => {
      // Given
      const service = serviceHarness();
      const profileService = profileServiceHarness();
      const controller = new AdminAccessController(service, profileService);
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

  it('forces PENDING and createdAt desc on GET /users/access/requests', async () => {
    const service = serviceHarness();
    const profileService = profileServiceHarness();
    const controller = new AdminAccessController(service, profileService);
    const query = new AdminAccessListRequestDto();

    await controller.listRequests(REQUEST, query);

    expect(service.listRequests).toHaveBeenCalledWith(REQUEST.sessionGithubId, {
      query: '',
      pendingRequest: 'PENDING',
      sort: 'createdAt',
      direction: 'desc',
      page: 1,
      limit: 20,
    });
  });

  it('passes independent history pages to the service', async () => {
    // Given
    const service = serviceHarness();
    const profileService = profileServiceHarness();
    const controller = new AdminAccessController(service, profileService);
    const query = Object.assign(new AdminAccessHistoryRequestDto(), {
      staffAccessRequestPage: 2,
      staffAccessRequestLimit: 5,
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
        staffAccessRequests: { page: 2, limit: 5 },
        loginHistory: { page: 3, limit: 10 },
      },
    );
  });

  it('passes the parsed CAS command to PATCH /users/:id/access', async () => {
    // Given
    const service = serviceHarness();
    const profileService = profileServiceHarness();
    const controller = new AdminAccessController(service, profileService);
    const command = {
      expectedRole: 'STUDENT',
      desiredRole: 'STAFF',
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

  it('passes the parsed command to PATCH /users/:id/profile', async () => {
    // Given
    const service = serviceHarness();
    const profileService = profileServiceHarness();
    const controller = new AdminAccessController(service, profileService);
    const command = {
      name: '테스트관리자',
      studentId: '260001',
      department: '컴퓨터공학과',
    } as const;
    const body = {
      toCommand: () => command,
    } as PatchAdminUserProfileRequestDto;

    // When
    await controller.patchProfile(REQUEST, 'target-user', body);

    // Then
    expect(profileService.patchProfile).toHaveBeenCalledWith(
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
      const profileService = profileServiceHarness();
      const controller = new AdminAccessController(service, profileService);
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

  it('patchProfile rejects an invalid user id before service delegation', async () => {
    // Given
    const service = serviceHarness();
    const profileService = profileServiceHarness();
    const controller = new AdminAccessController(service, profileService);
    const body = {
      toCommand: jest.fn(),
    } as unknown as PatchAdminUserProfileRequestDto;

    // When
    const operation = controller.patchProfile(REQUEST, 'invalid id', body);

    // Then
    await expect(operation).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.INVALID_USER_ID, status: 400 },
    });
    expect(profileService.patchProfile).not.toHaveBeenCalled();
  });

  it.each(['get', 'getHistory', 'patchAccess', 'patchProfile'] as const)(
    "%s rejects the reserved 'me' id even if it reaches this controller(#787)",
    async (method) => {
      // Given — 'me'는 세션 사용자 예약어라 관리자 대리 조회/수정 대상이 될 수 없다.
      // 라우트 등록 순서가 UsersController를 우선하더라도, 이 검사가 이중 방어로 남는다.
      const service = serviceHarness();
      const profileService = profileServiceHarness();
      const controller = new AdminAccessController(service, profileService);
      const query = new AdminAccessHistoryRequestDto();
      const body = {
        toCommand: jest.fn(),
      } as unknown as PatchAdminAccessRequestDto &
        PatchAdminUserProfileRequestDto;

      // When
      const operation =
        method === 'get'
          ? controller.get(REQUEST, 'me')
          : method === 'getHistory'
            ? controller.getHistory(REQUEST, 'me', query)
            : method === 'patchAccess'
              ? controller.patchAccess(REQUEST, 'me', body)
              : controller.patchProfile(REQUEST, 'me', body);

      // Then
      await expect(operation).rejects.toMatchObject({
        errorCode: { code: RolesErrorCode.INVALID_USER_ID, status: 400 },
      });
      if (method === 'patchProfile') {
        expect(profileService.patchProfile).not.toHaveBeenCalled();
      } else {
        expect(service[method]).not.toHaveBeenCalled();
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
    listRequests: jest.fn().mockResolvedValue({
      items: [],
      page: 1,
      limit: 20,
      total: 0,
      facets: emptyFacets(),
    }),
    facets: jest.fn().mockResolvedValue(emptyFacets()),
    get: jest.fn().mockResolvedValue({}),
    getHistory: jest.fn().mockResolvedValue({
      staffAccessRequests: { items: [], page: 1, limit: 20, total: 0 },
      loginHistory: { items: [], page: 1, limit: 20, total: 0 },
    }),
    patchAccess: jest.fn().mockResolvedValue({}),
  } satisfies Pick<
    AdminAccessService,
    'list' | 'listRequests' | 'facets' | 'get' | 'getHistory' | 'patchAccess'
  >;
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

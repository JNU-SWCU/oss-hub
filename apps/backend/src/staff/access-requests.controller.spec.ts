import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { SessionGuard } from '../auth/session.guard';
import type { AdminAccessService } from '../users/admin-access.service';
import { RolesErrorCode } from '../users/roles-error-code.error';
import { AccessRequestsController } from './access-requests.controller';
import {
  AccessRequestsHistoryRequestDto,
  AccessRequestsListRequestDto,
} from './dto/access-requests-request.dto';

const REQUEST: Pick<AuthenticatedRequest, 'sessionGithubId'> = {
  sessionGithubId: 9_131_400_001n,
};

describe('AccessRequestsController routes', () => {
  it.each([
    ['listRequests', RequestMethod.GET, 'access/requests', [SessionGuard]],
    ['get', RequestMethod.GET, ':id/access', [SessionGuard]],
    ['getHistory', RequestMethod.GET, ':id/access/history', [SessionGuard]],
  ] as const)(
    '%s owns the fixed method/path/guard contract',
    (name, method, path, guards) => {
      const handler: unknown = Object.getOwnPropertyDescriptor(
        AccessRequestsController.prototype,
        name,
      )?.value;
      expect(typeof handler).toBe('function');
      if (typeof handler !== 'function') {
        throw new TypeError(`Missing AccessRequestsController.${name}`);
      }
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(method);
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual(guards);
    },
  );

  it('uses the users resource prefix', () => {
    expect(Reflect.getMetadata(PATH_METADATA, AccessRequestsController)).toBe(
      'users',
    );
  });
});

describe('AccessRequestsController delegation', () => {
  it('forces PENDING and createdAt desc on GET /users/access/requests', async () => {
    const service = serviceHarness();
    const controller = new AccessRequestsController(service);
    const query = new AccessRequestsListRequestDto();

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
    const service = serviceHarness();
    const controller = new AccessRequestsController(service);
    const query = Object.assign(new AccessRequestsHistoryRequestDto(), {
      staffAccessRequestPage: 2,
      staffAccessRequestLimit: 5,
      loginPage: 3,
      loginLimit: 10,
    });

    await controller.getHistory(REQUEST, 'target-user', query);

    expect(service.getHistory).toHaveBeenCalledWith(
      REQUEST.sessionGithubId,
      'target-user',
      {
        staffAccessRequests: { page: 2, limit: 5 },
        loginHistory: { page: 3, limit: 10 },
      },
    );
  });

  it.each([
    ['get', 'invalid id'],
    ['getHistory', 'invalid id'],
    ['get', 'me'],
    ['getHistory', 'me'],
  ] as const)(
    '%s rejects the user id %p before service delegation(#787)',
    async (method, id) => {
      const service = serviceHarness();
      const controller = new AccessRequestsController(service);
      const query = new AccessRequestsHistoryRequestDto();

      const operation =
        method === 'get'
          ? controller.get(REQUEST, id)
          : controller.getHistory(REQUEST, id, query);

      await expect(operation).rejects.toMatchObject({
        errorCode: { code: RolesErrorCode.INVALID_USER_ID, status: 400 },
      });
      expect(service[method]).not.toHaveBeenCalled();
    },
  );
});

function serviceHarness() {
  return {
    listRequests: jest.fn().mockResolvedValue({
      items: [],
      page: 1,
      limit: 20,
      total: 0,
      facets: {
        roles: { unassigned: 0, student: 0, staff: 0, admin: 0 },
        accountStatuses: { active: 0, deactivated: 0 },
        pendingRequests: { none: 0, pending: 0 },
      },
    }),
    get: jest.fn().mockResolvedValue({}),
    getHistory: jest.fn().mockResolvedValue({
      staffAccessRequests: { items: [], page: 1, limit: 20, total: 0 },
      loginHistory: { items: [], page: 1, limit: 20, total: 0 },
    }),
  } satisfies Pick<AdminAccessService, 'listRequests' | 'get' | 'getHistory'>;
}

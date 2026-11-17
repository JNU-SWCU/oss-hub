import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { AccountStatus } from '@prisma/client';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import type { AdminAccessPrincipal } from '../users/admin-access-read.repository';
import { AdminAccessService } from '../users/admin-access.service';
import {
  ADMIN_GITHUB_ID,
  InMemoryAdminAccessRepository,
  PENDING_REQUEST,
  STAFF_GITHUB_ID,
  accessUser,
  auditLogHarness,
} from '../users/admin-access.service.spec-support';
import { MemberKind } from '../users/user-contract.config';
import { RolesErrorCode } from '../users/roles-error-code.error';
import { AccessRequestsController } from './access-requests.controller';
import {
  AccessRequestsHistoryRequestDto,
  AccessRequestsListRequestDto,
} from './dto/access-requests-list-request.dto';
import { HistoryMetadataService } from '../platform/history-metadata.service';
import { UserProfileService } from '../users/user-profile.service';
import { AdminAccessMutationService } from '../users/admin-access-mutation.service';

const REQUEST: Pick<AuthenticatedRequest, 'sessionGithubId' | 'principal'> = {
  sessionGithubId: 9_131_400_001n,
  principal: { githubId: 9_131_400_001n } as AuthenticatedRequest['principal'],
};

describe('AccessRequestsController routes', () => {
  it.each([
    ['listRequests', RequestMethod.GET, 'access/requests', undefined],
    ['get', RequestMethod.GET, ':id/access', undefined],
    ['getHistory', RequestMethod.GET, ':id/access/history', undefined],
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

    expect(service.listRequests).toHaveBeenCalledWith(REQUEST.principal, query);
    expect(service.requestQueueQueryFromRequest(query)).toEqual({
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
      REQUEST.principal,
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

const PARTICIPATION = {
  programId: 'participation-secret-program',
  programName: 'participation-secret-program-name',
  teamName: 'participation-secret-team-name',
  isLeader: true,
} as const;

describe('AccessRequestsController participation privacy', () => {
  it('withholds a pending applicant participations from a non-admin STAFF reviewer', async () => {
    const response = await controllerWithPendingApplicant().get(
      requestOf(reviewer()),
      'target',
    );

    expect(response.isSelf).toBe(false);
    expect(response.pendingRequest?.id).toBe(PENDING_REQUEST.id);
    expect(response.profile.department).toBe('소프트웨어공학과');
    expect(response.participations).toBeNull();
    expect(JSON.stringify(response)).not.toContain('participation-secret');
  });

  it.each([
    [
      'an ADMIN reviewer',
      reviewer({ githubId: ADMIN_GITHUB_ID, hasAdminAccess: true }),
      undefined,
      false,
    ],
    ['the applicant themself', reviewer(), STAFF_GITHUB_ID, true],
  ] as const)(
    'returns participations to %s',
    async (_, viewer, applicantGithubId, isSelf) => {
      const response = await controllerWithPendingApplicant(
        applicantGithubId,
      ).get(requestOf(viewer), 'target');

      expect(response.isSelf).toBe(isSelf);
      expect(response.participations).toEqual([PARTICIPATION]);
    },
  );
});

function controllerWithPendingApplicant(
  applicantGithubId?: bigint,
): AccessRequestsController {
  const repository = new InMemoryAdminAccessRepository();
  repository.target = accessUser({
    pendingRequest: PENDING_REQUEST,
    ...(applicantGithubId === undefined ? {} : { githubId: applicantGithubId }),
  });
  repository.participationMemberships = [
    {
      team: {
        name: PARTICIPATION.teamName,
        leaderId: 'target',
        program: {
          id: PARTICIPATION.programId,
          name: PARTICIPATION.programName,
        },
      },
    },
  ];
  return new AccessRequestsController(
    new AdminAccessService(
      repository,
      auditLogHarness().service,
      new AdminAccessMutationService(
        new HistoryMetadataService(),
        new UserProfileService(),
      ),
    ),
  );
}

function reviewer(
  overrides: Partial<AdminAccessPrincipal> = {},
): AuthenticatedRequest['principal'] {
  const principal: AdminAccessPrincipal = {
    githubId: STAFF_GITHUB_ID,
    memberKind: MemberKind.STAFF,
    isProfileComplete: true,
    hasStaffAccess: true,
    hasAdminAccess: false,
    accountStatus: AccountStatus.ACTIVE,
    ...overrides,
  };
  return principal as AuthenticatedRequest['principal'];
}

function requestOf(
  principal: AuthenticatedRequest['principal'],
): Pick<AuthenticatedRequest, 'sessionGithubId' | 'principal'> {
  return { sessionGithubId: principal.githubId, principal };
}

function serviceHarness() {
  return Object.assign(Object.create(AdminAccessService.prototype) as object, {
    adminAccessMutationService: new AdminAccessMutationService(
      new HistoryMetadataService(),
      new UserProfileService(),
    ),
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
  }) as unknown as AdminAccessService & {
    listRequests: jest.Mock;
    get: jest.Mock;
    getHistory: jest.Mock;
  };
}

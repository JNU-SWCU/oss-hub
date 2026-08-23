import { AccountStatus, Role } from '@prisma/client';
import { AuthErrorCode } from '../auth/auth-error-code.enum';
import { RolesErrorCode } from '../roles/roles-error-code.enum';
import { ADMIN_ACCESS_PENDING_FILTERS } from './domain/admin-access';
import { AdminAccessService } from './admin-access.service';
import {
  ADMIN_GITHUB_ID,
  InMemoryAdminAccessRepository,
  PENDING_REQUEST,
  STAFF_GITHUB_ID,
  accessUser,
  adminActor,
  auditLogHarness,
  staffActor,
} from './admin-access.service.spec-support';

describe('AdminAccessService reads', () => {
  it('returns paged users with actor-relative isSelf state', async () => {
    // Given
    const repository = new InMemoryAdminAccessRepository();
    repository.target = accessUser({
      id: 'admin',
      githubId: ADMIN_GITHUB_ID,
      role: Role.ADMIN,
    });
    const service = new AdminAccessService(
      repository,
      auditLogHarness().service,
    );

    // When
    const result = await service.list(ADMIN_GITHUB_ID, {
      query: '',
      page: 1,
      limit: 20,
    });

    // Then
    expect(result.items).toEqual([
      expect.objectContaining({ id: 'admin', isSelf: true }),
    ]);
  });

  it('returns facets and separately bounded role-request/login histories', async () => {
    // Given
    const repository = new InMemoryAdminAccessRepository();
    const service = new AdminAccessService(
      repository,
      auditLogHarness().service,
    );

    // When
    const [facets, history] = await Promise.all([
      service.facets(ADMIN_GITHUB_ID, { query: '', page: 1, limit: 20 }),
      service.getHistory(ADMIN_GITHUB_ID, 'target', {
        staffAccessRequests: { page: 2, limit: 5 },
        loginHistory: { page: 3, limit: 10 },
      }),
    ]);

    // Then
    expect(facets.roles.student).toBe(1);
    expect(history).toEqual({
      staffAccessRequests: { items: [], page: 2, limit: 5, total: 0 },
      loginHistory: { items: [], page: 3, limit: 10, total: 0 },
    });
  });

  it.each([
    ['missing', null, AuthErrorCode.UNAUTHENTICATED, 401],
    [
      'deactivated',
      adminActor({ accountStatus: AccountStatus.DEACTIVATED }),
      AuthErrorCode.UNAUTHENTICATED,
      401,
    ],
    [
      'staff',
      adminActor({ role: Role.STAFF, hasAdminAccess: false }),
      RolesErrorCode.ADMIN_ONLY,
      403,
    ],
  ] as const)(
    'rejects %s actors before reading users',
    async (_, actor, code, status) => {
      // Given
      const repository = new InMemoryAdminAccessRepository();
      repository.actor = actor;
      const service = new AdminAccessService(
        repository,
        auditLogHarness().service,
      );

      // When / Then
      await expect(
        service.list(ADMIN_GITHUB_ID, { query: '', page: 1, limit: 20 }),
      ).rejects.toMatchObject({ errorCode: { code, status } });
    },
  );

  it('requires an existing user before returning detail or histories', async () => {
    // Given
    const repository = new InMemoryAdminAccessRepository();
    repository.target = null;
    const service = new AdminAccessService(
      repository,
      auditLogHarness().service,
    );

    // When / Then
    await expect(
      service.get(ADMIN_GITHUB_ID, 'missing-user'),
    ).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.USER_NOT_FOUND, status: 404 },
    });
    await expect(
      service.getHistory(ADMIN_GITHUB_ID, 'missing-user', {
        staffAccessRequests: { page: 1, limit: 20 },
        loginHistory: { page: 1, limit: 20 },
      }),
    ).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.USER_NOT_FOUND, status: 404 },
    });
  });

  it('lets STAFF list the pending queue but not the directory', async () => {
    const repository = new InMemoryAdminAccessRepository();
    repository.actor = staffActor();
    repository.target = accessUser({
      role: null,
      pendingRequest: PENDING_REQUEST,
    });
    const service = new AdminAccessService(
      repository,
      auditLogHarness().service,
    );

    await expect(
      service.list(STAFF_GITHUB_ID, { query: '', page: 1, limit: 20 }),
    ).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.ADMIN_ONLY, status: 403 },
    });
    await expect(
      service.listRequests(STAFF_GITHUB_ID, {
        query: '',
        page: 1,
        limit: 20,
        pendingRequest: ADMIN_ACCESS_PENDING_FILTERS.PENDING,
      }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ id: 'target' })],
    });
  });

  it('hides a user without a pending request from STAFF as ROL_010', async () => {
    const repository = new InMemoryAdminAccessRepository();
    repository.actor = staffActor();
    repository.target = accessUser({ pendingRequest: null });
    const service = new AdminAccessService(
      repository,
      auditLogHarness().service,
    );

    await expect(service.get(STAFF_GITHUB_ID, 'target')).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.USER_NOT_FOUND, status: 404 },
    });
    await expect(
      service.getHistory(STAFF_GITHUB_ID, 'target', {
        staffAccessRequests: { page: 1, limit: 20 },
        loginHistory: { page: 1, limit: 20 },
      }),
    ).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.USER_NOT_FOUND, status: 404 },
    });
  });

  it('lets STAFF read a pending target', async () => {
    const repository = new InMemoryAdminAccessRepository();
    repository.actor = staffActor();
    repository.target = accessUser({
      role: null,
      pendingRequest: PENDING_REQUEST,
    });
    const service = new AdminAccessService(
      repository,
      auditLogHarness().service,
    );

    await expect(service.get(STAFF_GITHUB_ID, 'target')).resolves.toMatchObject(
      {
        id: 'target',
        pendingRequest: PENDING_REQUEST,
      },
    );
  });
});

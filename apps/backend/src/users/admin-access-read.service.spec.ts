import { AccountStatus } from '@prisma/client';
import { AuthErrorCode } from '../auth/auth-error-code.error';
import { RolesErrorCode } from './roles-error-code.error';
import { AdminAccessService } from './admin-access.service';
import {
  ADMIN_GITHUB_ID,
  InMemoryAdminAccessRepository,
  PENDING_REQUEST,
  accessUser,
  adminActor,
  auditLogHarness,
  staffActor,
  roleFacts,
} from './admin-access.service.spec-support';
import { ADMIN_ACCESS_PENDING_FILTERS } from './admin-access-query.config';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';
import { AdminAccessMutationService } from './admin-access-mutation.service';
import { UserProfileService } from './user-profile.service';

describe('AdminAccessService reads', () => {
  it('returns paged users with actor-relative isSelf state', async () => {
    const repository = new InMemoryAdminAccessRepository();
    repository.target = accessUser({
      id: 'admin',
      githubId: ADMIN_GITHUB_ID,
      hasAdminAccess: true,
    });
    const service = new AdminAccessService(
      repository,
      auditLogHarness().service,
      new AdminAccessMutationService(
        new AuditLogMetadataService(),
        new UserProfileService(),
      ),
    );

    const result = await service.list(adminActor(), {
      query: '',
      page: 1,
      limit: 20,
    });

    expect(result.items).toEqual([
      expect.objectContaining({ id: 'admin', isSelf: true }),
    ]);
  });

  it('returns facets and separately bounded role-request/login histories', async () => {
    const repository = new InMemoryAdminAccessRepository();
    const service = new AdminAccessService(
      repository,
      auditLogHarness().service,
      new AdminAccessMutationService(
        new AuditLogMetadataService(),
        new UserProfileService(),
      ),
    );

    const [facets, history] = await Promise.all([
      service.facets(adminActor(), { query: '', page: 1, limit: 20 }),
      service.getHistory(adminActor(), 'target', {
        staffAccessRequests: { page: 2, limit: 5 },
        loginHistory: { page: 3, limit: 10 },
      }),
    ]);

    expect(facets.roles.student).toBe(1);
    expect(history).toEqual({
      staffAccessRequests: { items: [], page: 2, limit: 5, total: 0 },
      loginHistory: { items: [], page: 3, limit: 10, total: 0 },
    });
  });

  it.each([
    [
      'deactivated',
      adminActor({ accountStatus: AccountStatus.DEACTIVATED }),
      AuthErrorCode.UNAUTHENTICATED,
      401,
    ],
    [
      'staff',
      adminActor({ hasAdminAccess: false }),
      RolesErrorCode.ADMIN_ONLY,
      403,
    ],
  ] as const)(
    'rejects %s actors before reading users',
    async (_, actor, code, status) => {
      const repository = new InMemoryAdminAccessRepository();
      const service = new AdminAccessService(
        repository,
        auditLogHarness().service,
        new AdminAccessMutationService(
          new AuditLogMetadataService(),
          new UserProfileService(),
        ),
      );

      await expect(
        service.list(actor, { query: '', page: 1, limit: 20 }),
      ).rejects.toMatchObject({ errorCode: { code, status } });
    },
  );

  it('requires an existing user before returning detail or histories', async () => {
    const repository = new InMemoryAdminAccessRepository();
    repository.target = null;
    const service = new AdminAccessService(
      repository,
      auditLogHarness().service,
      new AdminAccessMutationService(
        new AuditLogMetadataService(),
        new UserProfileService(),
      ),
    );

    await expect(
      service.get(adminActor(), 'missing-user'),
    ).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.USER_NOT_FOUND, status: 404 },
    });
    await expect(
      service.getHistory(adminActor(), 'missing-user', {
        staffAccessRequests: { page: 1, limit: 20 },
        loginHistory: { page: 1, limit: 20 },
      }),
    ).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.USER_NOT_FOUND, status: 404 },
    });
  });

  it('lets STAFF list the pending queue but not the directory', async () => {
    const repository = new InMemoryAdminAccessRepository();
    repository.target = accessUser({
      ...roleFacts(null),
      pendingRequest: PENDING_REQUEST,
    });
    const service = new AdminAccessService(
      repository,
      auditLogHarness().service,
      new AdminAccessMutationService(
        new AuditLogMetadataService(),
        new UserProfileService(),
      ),
    );

    await expect(
      service.list(staffActor(), { query: '', page: 1, limit: 20 }),
    ).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.ADMIN_ONLY, status: 403 },
    });
    await expect(
      service.listRequests(staffActor(), {
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
    repository.target = accessUser({ pendingRequest: null });
    const service = new AdminAccessService(
      repository,
      auditLogHarness().service,
      new AdminAccessMutationService(
        new AuditLogMetadataService(),
        new UserProfileService(),
      ),
    );

    await expect(service.get(staffActor(), 'target')).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.USER_NOT_FOUND, status: 404 },
    });
    await expect(
      service.getHistory(staffActor(), 'target', {
        staffAccessRequests: { page: 1, limit: 20 },
        loginHistory: { page: 1, limit: 20 },
      }),
    ).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.USER_NOT_FOUND, status: 404 },
    });
  });

  it('lets STAFF read a pending target', async () => {
    const repository = new InMemoryAdminAccessRepository();
    repository.target = accessUser({
      ...roleFacts(null),
      pendingRequest: PENDING_REQUEST,
    });
    const service = new AdminAccessService(
      repository,
      auditLogHarness().service,
      new AdminAccessMutationService(
        new AuditLogMetadataService(),
        new UserProfileService(),
      ),
    );

    await expect(service.get(staffActor(), 'target')).resolves.toMatchObject({
      id: 'target',
      pendingRequest: PENDING_REQUEST,
    });
  });
});

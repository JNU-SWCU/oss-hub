import { AccountStatus, LoginHistoryEvent, Role } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { RolesErrorCode } from '../roles/roles-error-code.enum';
import { AdminAccessHttpHarness } from './admin-access.http.integration-support';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const harness = new AdminAccessHttpHarness('reads', 9_003_900_000n);

beforeAll(async () => {
  await harness.start();
});

afterAll(async () => {
  await harness.stop();
});

it('serves all four bounded read routes with explicit response DTOs', async () => {
  // Given
  const actor = await harness.createUser(
    'reads-actor',
    Role.ADMIN,
    AccountStatus.ACTIVE,
  );
  const target = await harness.createUser(
    'reads-target',
    Role.STUDENT,
    AccountStatus.ACTIVE,
  );
  const readQuery = 'synthetic-http-reads';
  const loginAt = new Date('2026-07-31T00:00:00.000Z');
  await harness.prisma.loginHistory.create({
    data: {
      id: `${target.id}:login`,
      userId: target.id,
      event: LoginHistoryEvent.LOGIN,
      success: true,
      loginAt,
    },
  });

  // When
  const [list, facets, detail, history] = await Promise.all([
    harness.request(
      'GET',
      `/users/access?page=1&limit=1&query=${readQuery}`,
      actor.githubId,
    ),
    harness.request(
      'GET',
      `/users/access/facets?query=${readQuery}`,
      actor.githubId,
    ),
    harness.request('GET', `/users/${target.id}/access`, actor.githubId),
    harness.request(
      'GET',
      `/users/${target.id}/access/history?roleRequestLimit=1&loginLimit=1`,
      actor.githubId,
    ),
  ]);

  // Then
  expect([list.status, facets.status, detail.status, history.status]).toEqual([
    200, 200, 200, 200,
  ]);
  await expect(list.json()).resolves.toMatchObject({
    items: [expect.objectContaining({ id: actor.id })],
    page: 1,
    limit: 1,
    total: 2,
    facets: {
      roles: { unassigned: 0, student: 1, staff: 0, admin: 1 },
      accountStatuses: { active: 2, deactivated: 0 },
      pendingRequests: { none: 2, pending: 0 },
    },
  });
  await expect(facets.json()).resolves.toMatchObject({
    roles: { unassigned: 0, student: 1, staff: 0, admin: 1 },
    accountStatuses: { active: 2, deactivated: 0 },
    pendingRequests: { none: 2, pending: 0 },
  });
  await expect(detail.json()).resolves.toMatchObject({
    id: target.id,
    lastLoginAt: loginAt.toISOString(),
  });
  await expect(history.json()).resolves.toMatchObject({
    roleRequests: { page: 1, limit: 1 },
    loginHistory: { page: 1, limit: 1 },
  });
});

it('executes PATCH /users/:id/access through the real transaction and audit path', async () => {
  // Given
  const actor = await harness.createUser(
    'patch-actor',
    Role.ADMIN,
    AccountStatus.ACTIVE,
  );
  const target = await harness.createUser(
    'patch-target',
    Role.STUDENT,
    AccountStatus.ACTIVE,
  );

  // When
  const response = await harness.request(
    'PATCH',
    `/users/${target.id}/access`,
    actor.githubId,
    accessBody({ desiredRole: Role.STAFF }),
  );

  // Then
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    id: target.id,
    role: Role.STAFF,
    accountStatus: AccountStatus.ACTIVE,
  });
  await expect(
    harness.prisma.auditLog.count({ where: { targetId: target.id } }),
  ).resolves.toBe(1);
});

it('rejects a legacy PATCH /users/:id/role demotion of the final active ADMIN with RFC7807', async () => {
  // Given
  await harness.demoteAllActiveAdmins();
  const actor = await harness.createUser(
    'legacy-final-admin',
    Role.ADMIN,
    AccountStatus.ACTIVE,
  );

  // When
  const response = await harness.request(
    'PATCH',
    `/users/${actor.id}/role`,
    actor.githubId,
    { role: Role.STAFF },
  );

  // Then
  await expectProblem(response, 409, RolesErrorCode.LAST_ACTIVE_ADMIN_REQUIRED);
  await expect(
    harness.prisma.user.findUniqueOrThrow({ where: { id: actor.id } }),
  ).resolves.toMatchObject({
    role: Role.ADMIN,
    accountStatus: AccountStatus.ACTIVE,
  });
  await expect(
    harness.prisma.auditLog.count({ where: { targetId: actor.id } }),
  ).resolves.toBe(0);
});

it('settles concurrent legacy and unified ADMIN demotions with one active ADMIN remaining', async () => {
  // Given
  await harness.demoteAllActiveAdmins();
  const firstAdmin = await harness.createUser(
    'interleaving-first-admin',
    Role.ADMIN,
    AccountStatus.ACTIVE,
  );
  const secondAdmin = await harness.createUser(
    'interleaving-second-admin',
    Role.ADMIN,
    AccountStatus.ACTIVE,
  );

  // When
  const responses = await Promise.all([
    harness.request(
      'PATCH',
      `/users/${secondAdmin.id}/role`,
      firstAdmin.githubId,
      { role: Role.STAFF },
    ),
    harness.request(
      'PATCH',
      `/users/${firstAdmin.id}/access`,
      secondAdmin.githubId,
      accessBody({ expectedRole: Role.ADMIN, desiredRole: Role.STAFF }),
    ),
  ]);

  // Then
  expect(responses.map((response) => response.status).sort()).toEqual([
    200, 409,
  ]);
  await expect(
    harness.prisma.user.count({
      where: { role: Role.ADMIN, accountStatus: AccountStatus.ACTIVE },
    }),
  ).resolves.toBeGreaterThanOrEqual(1);
  await expect(
    harness.prisma.auditLog.count({
      where: { targetId: { in: [firstAdmin.id, secondAdmin.id] } },
    }),
  ).resolves.toBe(1);
});

function accessBody(overrides: Readonly<Record<string, unknown>>) {
  return {
    expectedRole: Role.STUDENT,
    desiredRole: Role.STUDENT,
    expectedAccountStatus: AccountStatus.ACTIVE,
    desiredAccountStatus: AccountStatus.ACTIVE,
    expectedPendingRequest: null,
    ...overrides,
  };
}

it('returns 401/AUT_003 for an anonymous access-list request', async () => {
  const response = await harness.request('GET', '/users/access');

  expect(response.status).toBe(401);
  await expect(response.json()).resolves.toMatchObject({ code: 'AUT_003' });
});

it('returns 403/ROL_004 for a non-admin actor', async () => {
  const actor = await harness.createUser(
    'forbidden-actor',
    Role.STAFF,
    AccountStatus.ACTIVE,
  );

  const response = await harness.request(
    'GET',
    '/users/access',
    actor.githubId,
  );

  await expectProblem(response, 403, RolesErrorCode.ADMIN_ONLY);
});

it('returns 400/ROL_011 for an invalid user id', async () => {
  const actor = await harness.createUser(
    'invalid-id-actor',
    Role.ADMIN,
    AccountStatus.ACTIVE,
  );

  const response = await harness.request(
    'GET',
    '/users/invalid%20id/access',
    actor.githubId,
  );

  await expectProblem(response, 400, RolesErrorCode.INVALID_USER_ID);
});

it('returns 404/ROL_010 for a missing user', async () => {
  const actor = await harness.createUser(
    'missing-actor',
    Role.ADMIN,
    AccountStatus.ACTIVE,
  );

  const response = await harness.request(
    'GET',
    '/users/missing-user/access',
    actor.githubId,
  );

  await expectProblem(response, 404, RolesErrorCode.USER_NOT_FOUND);
});

async function expectProblem(
  response: Response,
  status: number,
  code: RolesErrorCode,
) {
  expect(response.status).toBe(status);
  expect(response.headers.get('content-type')).toContain(
    'application/problem+json',
  );
  await expect(response.json()).resolves.toMatchObject({ status, code });
}

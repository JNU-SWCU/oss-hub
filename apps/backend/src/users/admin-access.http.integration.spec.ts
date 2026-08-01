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

it('레거시 GET /users(목록)·PATCH /users/:id/role은 원자적 전환 이후 리다이렉트 없이 404를 반환한다(PR04H)', async () => {
  // Given
  const actor = await harness.createUser(
    'legacy-tombstone-actor',
    Role.ADMIN,
    AccountStatus.ACTIVE,
  );
  const target = await harness.createUser(
    'legacy-tombstone-target',
    Role.STUDENT,
    AccountStatus.ACTIVE,
  );

  // When
  const [listResponse, roleResponse] = await Promise.all([
    harness.request('GET', '/users', actor.githubId),
    harness.request('PATCH', `/users/${target.id}/role`, actor.githubId, {
      role: Role.STAFF,
    }),
  ]);

  // Then — 원자적 전환(PR04H)으로 AdminUsersController가 모듈 등록에서
  // 빠졌으므로 플레인 404가 나온다(별도 리다이렉트 핸들러 없음).
  expect(listResponse.status).toBe(404);
  expect(listResponse.redirected).toBe(false);
  expect(roleResponse.status).toBe(404);
  expect(roleResponse.redirected).toBe(false);
  await expect(
    harness.prisma.user.findUniqueOrThrow({ where: { id: target.id } }),
  ).resolves.toMatchObject({
    role: Role.STUDENT,
    accountStatus: AccountStatus.ACTIVE,
  });
  await expect(
    harness.prisma.auditLog.count({ where: { targetId: target.id } }),
  ).resolves.toBe(0);
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

it.each([
  ['STAFF', Role.STAFF],
  ['STUDENT', Role.STUDENT],
] as const)('returns 403/ROL_004 for a non-admin %s actor', async (_, role) => {
  const actor = await harness.createUser(
    `forbidden-actor-${role}`,
    role,
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

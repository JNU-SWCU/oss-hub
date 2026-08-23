import { AccountStatus, AffiliationKind, LoginHistoryEvent, MemberKind } from '@prisma/client';
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
    'ADMIN',
    AccountStatus.ACTIVE,
  );
  const target = await harness.createUser(
    'reads-target',
    'STUDENT',
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
      `/users/access?page=1&limit=1&query=${readQuery}&sort=createdAt&direction=asc`,
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
      `/users/${target.id}/access/history?staffAccessRequestLimit=1&loginLimit=1`,
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
    staffAccessRequests: { page: 1, limit: 1 },
    loginHistory: { page: 1, limit: 1 },
  });
});

it('executes PATCH /users/:id/access through the real transaction and audit path', async () => {
  // Given
  const actor = await harness.createUser(
    'patch-actor',
    'ADMIN',
    AccountStatus.ACTIVE,
  );
  const target = await harness.createUser(
    'patch-target',
    'STUDENT',
    AccountStatus.ACTIVE,
  );

  // When
  const response = await harness.request(
    'PATCH',
    `/users/${target.id}/access`,
    actor.githubId,
    accessBody({ desiredRole: 'STAFF' }),
  );

  // Then
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    id: target.id,
    role: 'STAFF',
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
    'ADMIN',
    AccountStatus.ACTIVE,
  );
  const target = await harness.createUser(
    'legacy-tombstone-target',
    'STUDENT',
    AccountStatus.ACTIVE,
  );

  // When
  const [listResponse, roleResponse] = await Promise.all([
    harness.request('GET', '/users', actor.githubId),
    harness.request('PATCH', `/users/${target.id}/role`, actor.githubId, {
      role: 'STAFF',
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
    hasStaffAccess: false,
    hasAdminAccess: false,
    accountStatus: AccountStatus.ACTIVE,
  });
  await expect(
    harness.prisma.auditLog.count({ where: { targetId: target.id } }),
  ).resolves.toBe(0);
});

function accessBody(overrides: Readonly<Record<string, unknown>>) {
  return {
    expectedRole: 'STUDENT',
    desiredRole: 'STUDENT',
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
  ['STAFF', 'STAFF'],
  ['STUDENT', 'STUDENT'],
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

/**
 * 쓰기 경로의 관리자 게이트를 실 라우트에서 못 박는다(#687).
 *
 * 여기가 비어 있었다 — 읽기 목록에만 403 검사가 있어서 두 PATCH 라우트의 관리자 검사를
 * 통째로 지워도 모든 테스트가 통과했다. 권한 검증을 잠금 뒤로 옮기는 이번 변경이 그
 * 검사를 실수로 무력화하면 이 테스트가 먼저 무너진다.
 */
it.each([
  ['access', (id: string) => `/users/${id}/access`],
  ['profile', (id: string) => `/users/${id}/profile`],
] as const)(
  'returns 403/ROL_004 for a non-admin PATCH /users/:id/%s',
  async (route, path) => {
    // Given
    const actor = await harness.createUser(
      `forbidden-patch-${route}-actor`,
      'STAFF',
      AccountStatus.ACTIVE,
    );
    const target = await harness.createUser(
      `forbidden-patch-${route}-target`,
      'STUDENT',
      AccountStatus.ACTIVE,
    );
    const body =
      route === 'access'
        ? accessBody({ desiredRole: 'STAFF' })
        : { name: '합성 새 이름' };

    // When
    const response = await harness.request(
      'PATCH',
      path(target.id),
      actor.githubId,
      body,
    );

    // Then
    await expectProblem(response, 403, RolesErrorCode.ADMIN_ONLY);
    await expect(
      harness.prisma.user.findUniqueOrThrow({ where: { id: target.id } }),
    ).resolves.toMatchObject({
      hasStaffAccess: false,
      hasAdminAccess: false,
    });
    await expect(
      harness.prisma.auditLog.count({ where: { targetId: target.id } }),
    ).resolves.toBe(0);
  },
);

it('lets STAFF read the pending queue but not the directory', async () => {
  const staff = await harness.createUser(
    'queue-staff',
    'STAFF',
    AccountStatus.ACTIVE,
  );
  const pending = await harness.createUser(
    'queue-pending',
    null,
    AccountStatus.ACTIVE,
  );
  const student = await harness.createUser(
    'queue-student',
    'STUDENT',
    AccountStatus.ACTIVE,
  );
  await harness.createPendingRequest(pending.id);

  const [directory, queue] = await Promise.all([
    harness.request('GET', '/users/access', staff.githubId),
    harness.request('GET', '/users/access/requests', staff.githubId),
  ]);

  await expectProblem(directory, 403, RolesErrorCode.ADMIN_ONLY);
  expect(queue.status).toBe(200);
  const body = (await queue.json()) as {
    readonly items: readonly { readonly id: string }[];
  };
  expect(body.items.map((item) => item.id)).toContain(pending.id);
  expect(body.items.map((item) => item.id)).not.toContain(student.id);
});

it('lets STAFF approve a pending request and rejects SET_ROLE', async () => {
  const staff = await harness.createUser(
    'approve-staff',
    'STAFF',
    AccountStatus.ACTIVE,
  );
  const pending = await harness.createUser(
    'approve-pending',
    null,
    AccountStatus.ACTIVE,
  );
  const pendingProfile = {
    name: '합성 승인 대상',
    studentId: '813017',
    department: '소프트웨어공학과',
    memberKind: MemberKind.STUDENT,
    affiliationKind: AffiliationKind.DEPARTMENT,
    affiliationName: '소프트웨어공학과',
  };
  await harness.prisma.user.update({
    where: { id: pending.id },
    data: {
      selectedMemberKind: MemberKind.STUDENT,
      profile: { create: pendingProfile },
    },
  });
  const request = await harness.createPendingRequest(pending.id);
  const student = await harness.createUser(
    'approve-student',
    'STUDENT',
    AccountStatus.ACTIVE,
  );

  const detail = await harness.request(
    'GET',
    `/users/${pending.id}/access`,
    staff.githubId,
  );
  const missing = await harness.request(
    'GET',
    `/users/${student.id}/access`,
    staff.githubId,
  );
  const approve = await harness.request(
    'PATCH',
    `/users/${pending.id}/access`,
    staff.githubId,
    accessBody({
      expectedRole: 'STUDENT',
      desiredRole: 'STAFF',
      expectedPendingRequest: { id: request.id, status: 'PENDING' },
      requestDecision: { decision: 'APPROVE' },
    }),
  );
  const setRole = await harness.request(
    'PATCH',
    `/users/${student.id}/access`,
    staff.githubId,
    accessBody({ desiredRole: 'STAFF' }),
  );

  expect(detail.status).toBe(200);
  await expectProblem(missing, 404, RolesErrorCode.USER_NOT_FOUND);
  if (approve.status !== 200) {
    throw new Error(
      `STAFF approve expected 200, got ${String(approve.status)} ${JSON.stringify(await approve.json())}`,
    );
  }
  await expectProblem(setRole, 403, RolesErrorCode.ADMIN_ONLY);
  await expect(
    harness.prisma.user.findUniqueOrThrow({ where: { id: pending.id } }),
  ).resolves.toMatchObject({
    hasStaffAccess: true,
    hasAdminAccess: false,
  });
  await expect(
    harness.prisma.auditLog.count({
      where: {
        targetId: request.id,
        action: 'STAFF_ROLE_REQUEST_APPROVED',
      },
    }),
  ).resolves.toBe(1);
});

it('returns 400/ROL_011 for an invalid user id', async () => {
  const actor = await harness.createUser(
    'invalid-id-actor',
    'ADMIN',
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
    'ADMIN',
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

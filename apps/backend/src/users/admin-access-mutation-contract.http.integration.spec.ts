import { AccountStatus, Role, RoleRequestStatus } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import {
  ACCESS_AUDIT_ACTIONS,
  ACCESS_AUDIT_EVENT_KINDS,
} from '../audit-log/audit-log-metadata';
import { RolesErrorCode } from '../roles/roles-error-code.enum';
import { AdminAccessHttpHarness } from './admin-access.http.integration-support';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const harness = new AdminAccessHttpHarness('mutation-contract', 9_003_950_000n);

beforeAll(async () => {
  await harness.start();
});

afterAll(async () => {
  await harness.stop();
});

it('returns the complete authoritative RFC7807 projection for a stale CAS', async () => {
  // Given
  const actor = await harness.createUser(
    'stale-projection-actor',
    Role.ADMIN,
    AccountStatus.ACTIVE,
  );
  const target = await harness.createUser(
    'stale-projection-target',
    Role.STAFF,
    AccountStatus.ACTIVE,
  );

  // When
  const response = await harness.request(
    'PATCH',
    `/users/${target.id}/access`,
    actor.githubId,
    accessBody({ expectedRole: Role.STUDENT, desiredRole: Role.ADMIN }),
  );

  // Then
  expect(response.status).toBe(409);
  expect(response.headers.get('content-type')).toContain(
    'application/problem+json',
  );
  await expect(response.json()).resolves.toMatchObject({
    type: 'about:blank',
    title: 'CONFLICT',
    status: 409,
    detail: '사용자 접근 상태가 조회 당시와 달라졌습니다.',
    instance: `/api/v1/users/${target.id}/access`,
    code: RolesErrorCode.ACCESS_STATE_MISMATCH,
    currentAccess: {
      id: target.id,
      role: Role.STAFF,
      accountStatus: AccountStatus.ACTIVE,
      pendingRequest: null,
    },
  });
});

it.each([
  [
    'combined role/status change',
    RolesErrorCode.ACCESS_TRANSITION_NOT_ALLOWED,
    409,
    Role.STAFF,
    accessBody({
      expectedRole: Role.STAFF,
      desiredRole: Role.STUDENT,
      desiredAccountStatus: AccountStatus.DEACTIVATED,
    }),
  ],
  [
    'empty change',
    RolesErrorCode.ACCESS_CHANGE_REQUIRED,
    400,
    Role.STUDENT,
    accessBody({}),
  ],
] as const)(
  'returns the exact RFC7807 contract for %s',
  async (_, code, status, role, body) => {
    const actor = await harness.createUser(
      `${code}-actor`,
      Role.ADMIN,
      AccountStatus.ACTIVE,
    );
    const target = await harness.createUser(
      `${code}-target`,
      role,
      AccountStatus.ACTIVE,
    );

    const response = await harness.request(
      'PATCH',
      `/users/${target.id}/access`,
      actor.githubId,
      body,
    );

    await expectProblem(response, status, code);
  },
);

it('returns 409/ROL_015 when a pending request has no decision', async () => {
  const { actor, target, requestId } =
    await pendingScenario('decision-required');
  const response = await harness.request(
    'PATCH',
    `/users/${target.id}/access`,
    actor.githubId,
    accessBody({
      expectedRole: null,
      desiredRole: Role.STAFF,
      expectedPendingRequest: {
        id: requestId,
        status: RoleRequestStatus.PENDING,
      },
    }),
  );

  await expectProblem(
    response,
    409,
    RolesErrorCode.PENDING_REQUEST_DECISION_REQUIRED,
  );
});

it('returns 400/ROL_016 for a contradictory pending-request decision', async () => {
  const { actor, target, requestId } =
    await pendingScenario('invalid-decision');
  const response = await harness.request(
    'PATCH',
    `/users/${target.id}/access`,
    actor.githubId,
    accessBody({
      expectedRole: null,
      desiredRole: Role.STUDENT,
      expectedPendingRequest: {
        id: requestId,
        status: RoleRequestStatus.PENDING,
      },
      requestDecision: { decision: 'APPROVE' },
    }),
  );

  await expectProblem(
    response,
    400,
    RolesErrorCode.INVALID_ACCESS_REQUEST_DECISION,
  );
});

it('returns 409/ROL_017 for administrator self-deactivation', async () => {
  const actor = await harness.createUser(
    'self-deactivate',
    Role.ADMIN,
    AccountStatus.ACTIVE,
  );
  await harness.createUser('self-backup', Role.ADMIN, AccountStatus.ACTIVE);
  const response = await harness.request(
    'PATCH',
    `/users/${actor.id}/access`,
    actor.githubId,
    accessBody({
      expectedRole: Role.ADMIN,
      desiredRole: Role.ADMIN,
      desiredAccountStatus: AccountStatus.DEACTIVATED,
    }),
  );

  await expectProblem(
    response,
    409,
    RolesErrorCode.SELF_DEACTIVATION_FORBIDDEN,
  );
});

it('returns 409/ROL_018 when demotion would remove the final active admin', async () => {
  await harness.demoteAllActiveAdmins();
  const actor = await harness.createUser(
    'final-admin',
    Role.ADMIN,
    AccountStatus.ACTIVE,
  );
  const response = await harness.request(
    'PATCH',
    `/users/${actor.id}/access`,
    actor.githubId,
    accessBody({ expectedRole: Role.ADMIN, desiredRole: Role.STAFF }),
  );

  await expectProblem(response, 409, RolesErrorCode.LAST_ACTIVE_ADMIN_REQUIRED);
});

it('revokes STAFF access through the real route, clearing the role and appending a REVOKED request', async () => {
  // Given — 신청 이력이 없는 직접 부여 STAFF다. 회수 행은 조건 없이 생겨야 한다.
  const actor = await harness.createUser(
    'revoke-actor',
    Role.ADMIN,
    AccountStatus.ACTIVE,
  );
  const target = await harness.createUser(
    'revoke-target',
    Role.STAFF,
    AccountStatus.ACTIVE,
  );

  // When
  const response = await harness.request(
    'PATCH',
    `/users/${target.id}/access`,
    actor.githubId,
    accessBody({ expectedRole: Role.STAFF, desiredRole: null }),
  );

  // Then
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    readonly role: unknown;
    readonly decidedRequest: { readonly id: string; readonly status: string };
  };
  expect(body.role).toBeNull();
  expect(body.decidedRequest.status).toBe(RoleRequestStatus.REVOKED);
  await expect(
    harness.prisma.user.findUniqueOrThrow({ where: { id: target.id } }),
  ).resolves.toMatchObject({
    role: null,
    accountStatus: AccountStatus.ACTIVE,
  });
  const requests = await harness.prisma.roleRequest.findMany({
    where: { userId: target.id },
  });
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    id: body.decidedRequest.id,
    status: RoleRequestStatus.REVOKED,
    decidedById: actor.id,
  });
  const revocationLogs = await harness.prisma.auditLog.findMany({
    where: { targetId: body.decidedRequest.id },
  });
  expect(revocationLogs).toHaveLength(1);
  expect(revocationLogs[0]).toMatchObject({
    action: ACCESS_AUDIT_ACTIONS.ROLE_REQUEST_REVOKED,
    targetType: 'ROLE_REQUEST',
    metadata: {
      eventKind: ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_REVOKED,
      before: {
        role: Role.STAFF,
        accountStatus: AccountStatus.ACTIVE,
        requestStatus: null,
      },
      after: {
        role: null,
        accountStatus: AccountStatus.ACTIVE,
        requestStatus: RoleRequestStatus.REVOKED,
      },
    },
  });
});

it('demotes STAFF to STUDENT through the real route without touching the request history', async () => {
  // Given
  const actor = await harness.createUser(
    'demote-actor',
    Role.ADMIN,
    AccountStatus.ACTIVE,
  );
  const target = await harness.createUser(
    'demote-target',
    Role.STAFF,
    AccountStatus.ACTIVE,
  );

  // When
  const response = await harness.request(
    'PATCH',
    `/users/${target.id}/access`,
    actor.githubId,
    accessBody({
      expectedRole: Role.STAFF,
      desiredRole: Role.STUDENT,
    }),
  );

  // Then
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    id: target.id,
    role: Role.STUDENT,
    accountStatus: AccountStatus.ACTIVE,
    pendingRequest: null,
    decidedRequest: null,
  });
  await expect(
    harness.prisma.user.findUniqueOrThrow({ where: { id: target.id } }),
  ).resolves.toMatchObject({
    role: Role.STUDENT,
    accountStatus: AccountStatus.ACTIVE,
  });
  // 강등은 회수가 아니다 — 요청 이력에 아무 행도 남기지 않는다.
  await expect(
    harness.prisma.roleRequest.count({ where: { userId: target.id } }),
  ).resolves.toBe(0);
  const logs = await harness.prisma.auditLog.findMany({
    where: { targetId: target.id },
  });
  expect(logs).toHaveLength(1);
  expect(logs[0]).toMatchObject({
    action: ACCESS_AUDIT_ACTIONS.DIRECT_ROLE_CHANGED,
    targetType: 'USER',
    targetId: target.id,
    metadata: {
      eventKind: ACCESS_AUDIT_EVENT_KINDS.DIRECT_ROLE_CHANGED,
      before: {
        role: Role.STAFF,
        accountStatus: AccountStatus.ACTIVE,
        requestStatus: null,
      },
      after: {
        role: Role.STUDENT,
        accountStatus: AccountStatus.ACTIVE,
        requestStatus: null,
      },
    },
  });
  await expect(
    harness.prisma.auditLog.update({
      where: { id: logs[0]?.id ?? 'missing' },
      data: { action: 'SYNTHETIC_MUTATION' },
    }),
  ).rejects.toThrow();
});

it('deactivates and reactivates through the real route while preserving STAFF role', async () => {
  // Given
  const actor = await harness.createUser(
    'status-actor',
    Role.ADMIN,
    AccountStatus.ACTIVE,
  );
  const target = await harness.createUser(
    'status-target',
    Role.STAFF,
    AccountStatus.ACTIVE,
  );

  // When
  const deactivateResponse = await harness.request(
    'PATCH',
    `/users/${target.id}/access`,
    actor.githubId,
    accessBody({
      expectedRole: Role.STAFF,
      desiredRole: Role.STAFF,
      desiredAccountStatus: AccountStatus.DEACTIVATED,
    }),
  );
  const reactivateResponse = await harness.request(
    'PATCH',
    `/users/${target.id}/access`,
    actor.githubId,
    accessBody({
      expectedRole: Role.STAFF,
      desiredRole: Role.STAFF,
      expectedAccountStatus: AccountStatus.DEACTIVATED,
      desiredAccountStatus: AccountStatus.ACTIVE,
    }),
  );

  // Then
  expect(deactivateResponse.status).toBe(200);
  await expect(deactivateResponse.json()).resolves.toMatchObject({
    id: target.id,
    role: Role.STAFF,
    accountStatus: AccountStatus.DEACTIVATED,
    pendingRequest: null,
    decidedRequest: null,
  });
  expect(reactivateResponse.status).toBe(200);
  await expect(reactivateResponse.json()).resolves.toMatchObject({
    id: target.id,
    role: Role.STAFF,
    accountStatus: AccountStatus.ACTIVE,
    pendingRequest: null,
    decidedRequest: null,
  });
  await expect(
    harness.prisma.user.findUniqueOrThrow({ where: { id: target.id } }),
  ).resolves.toMatchObject({
    role: Role.STAFF,
    accountStatus: AccountStatus.ACTIVE,
  });
  const logs = await harness.prisma.auditLog.findMany({
    where: { targetId: target.id },
    orderBy: { occurredAt: 'asc' },
  });
  expect(logs).toHaveLength(2);
  expect(logs[0]).toMatchObject({
    action: ACCESS_AUDIT_ACTIONS.ACCOUNT_STATUS_CHANGED,
    targetType: 'USER',
    targetId: target.id,
    metadata: {
      eventKind: ACCESS_AUDIT_EVENT_KINDS.ACCOUNT_STATUS_CHANGED,
      before: {
        role: Role.STAFF,
        accountStatus: AccountStatus.ACTIVE,
        requestStatus: null,
      },
      after: {
        role: Role.STAFF,
        accountStatus: AccountStatus.DEACTIVATED,
        requestStatus: null,
      },
    },
  });
  expect(logs[1]).toMatchObject({
    action: ACCESS_AUDIT_ACTIONS.ACCOUNT_STATUS_CHANGED,
    targetType: 'USER',
    targetId: target.id,
    metadata: {
      eventKind: ACCESS_AUDIT_EVENT_KINDS.ACCOUNT_STATUS_CHANGED,
      before: {
        role: Role.STAFF,
        accountStatus: AccountStatus.DEACTIVATED,
        requestStatus: null,
      },
      after: {
        role: Role.STAFF,
        accountStatus: AccountStatus.ACTIVE,
        requestStatus: null,
      },
    },
  });
  for (const log of logs) {
    await expect(
      harness.prisma.auditLog.update({
        where: { id: log.id },
        data: { action: 'SYNTHETIC_MUTATION' },
      }),
    ).rejects.toThrow();
  }
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

async function pendingScenario(label: string) {
  const actor = await harness.createUser(
    `${label}-actor`,
    Role.ADMIN,
    AccountStatus.ACTIVE,
  );
  const target = await harness.createUser(
    `${label}-target`,
    null,
    AccountStatus.ACTIVE,
  );
  const requestId = `${target.id}:pending`;
  await harness.prisma.roleRequest.create({
    data: { id: requestId, userId: target.id },
  });
  return { actor, target, requestId };
}

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

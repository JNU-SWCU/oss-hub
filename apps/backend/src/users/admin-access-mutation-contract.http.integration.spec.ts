import {
  userAuditRows,
  requestHistory,
  writeApprovalFixture,
} from './user-history.integration-fixture';

import { StaffAccessRequestStatus } from './user-contract.config';
import { AccountStatus } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { RolesErrorCode } from './roles-error-code.error';
import { AdminAccessHttpHarness } from './admin-access.http.integration-support';
import {
  ACCESS_AUDIT_ACTIONS,
  ACCESS_AUDIT_EVENT_KINDS,
} from '../platform/audit-log-metadata.config';
assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});
const harness = new AdminAccessHttpHarness('mutation-contract', 9003950000n);
beforeAll(async () => {
  await harness.start();
});
afterAll(async () => {
  await harness.stop();
});
it('returns the complete authoritative RFC7807 projection for a stale CAS', async () => {
  const actor = await harness.createUser(
    'stale-projection-actor',
    'ADMIN',
    AccountStatus.ACTIVE,
  );
  const target = await harness.createUser(
    'stale-projection-target',
    'STAFF',
    AccountStatus.ACTIVE,
  );
  const response = await harness.request(
    'PATCH',
    `/users/${target.id}/access`,
    actor.githubId,
    accessBody({ expectedRole: 'STUDENT', desiredRole: 'ADMIN' }),
  );
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
      role: 'STAFF',
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
    'STAFF',
    accessBody({
      expectedRole: 'STAFF',
      desiredRole: 'STUDENT',
      desiredAccountStatus: AccountStatus.DEACTIVATED,
    }),
  ],
  [
    'empty change',
    RolesErrorCode.ACCESS_CHANGE_REQUIRED,
    400,
    'STUDENT',
    accessBody({}),
  ],
] as const)(
  'returns the exact RFC7807 contract for %s',
  async (_, code, status, role, body) => {
    const actor = await harness.createUser(
      `${code}-actor`,
      'ADMIN',
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
      desiredRole: 'STAFF',
      expectedPendingRequest: {
        id: requestId,
        status: StaffAccessRequestStatus.PENDING,
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
      desiredRole: 'STUDENT',
      expectedPendingRequest: {
        id: requestId,
        status: StaffAccessRequestStatus.PENDING,
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
    'ADMIN',
    AccountStatus.ACTIVE,
  );
  await harness.createUser('self-backup', 'ADMIN', AccountStatus.ACTIVE);
  const response = await harness.request(
    'PATCH',
    `/users/${actor.id}/access`,
    actor.githubId,
    accessBody({
      expectedRole: 'ADMIN',
      desiredRole: 'ADMIN',
      desiredAccountStatus: AccountStatus.DEACTIVATED,
    }),
  );
  await expectProblem(
    response,
    409,
    RolesErrorCode.SELF_DEACTIVATION_FORBIDDEN,
  );
});
it('returns 400/ROL_021 when a legacy command tries to lower ADMIN display role', async () => {
  await harness.demoteAllActiveAdmins();
  const actor = await harness.createUser(
    'final-admin',
    'ADMIN',
    AccountStatus.ACTIVE,
  );
  const response = await harness.request(
    'PATCH',
    `/users/${actor.id}/access`,
    actor.githubId,
    accessBody({ expectedRole: 'ADMIN', desiredRole: 'STAFF' }),
  );
  await expectProblem(
    response,
    400,
    RolesErrorCode.INDEPENDENT_AUTHORITY_REQUIRED,
  );
  await expect(
    harness.prisma.user.findUniqueOrThrow({
      include: { admin: true },
      where: { id: actor.id },
    }),
  ).resolves.toMatchObject({
    approvalStatus: 'NOT_REQUIRED',
    admin: { userId: actor.id },
    accountStatus: AccountStatus.ACTIVE,
  });
  await expect(
    userAuditRows(harness.prisma, { targetId: actor.id }).then(
      (rows) => rows.length,
    ),
  ).resolves.toBe(0);
});
it('revokes requestless STAFF access without fabricating an application', async () => {
  const actor = await harness.createUser(
    'revoke-actor',
    'ADMIN',
    AccountStatus.ACTIVE,
  );
  const target = await harness.createUser(
    'revoke-target',
    'STAFF',
    AccountStatus.ACTIVE,
  );
  const response = await harness.request(
    'PATCH',
    `/users/${target.id}/access`,
    actor.githubId,
    accessBody({ expectedRole: 'STAFF', desiredRole: null }),
  );
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    role: null,
    decidedRequest: null,
    approvalStatus: 'REVOKED',
    approvalRequestId: null,
  });
  await expect(
    harness.prisma.user.findUniqueOrThrow({
      where: { id: target.id },
      include: { admin: true },
    }),
  ).resolves.toMatchObject({
    type: 'STAFF',
    approvalStatus: 'REVOKED',
    admin: null,
    accountStatus: 'ACTIVE',
  });
  await expect(requestHistory(harness.prisma, target.id)).resolves.toEqual([]);
  const logs = await userAuditRows(harness.prisma, { targetId: target.id });
  expect(logs).toHaveLength(1);
  expect(logs[0]).toMatchObject({
    action: ACCESS_AUDIT_ACTIONS.ROLE_REQUEST_REVOKED,
    targetType: 'USER',
    metadata: {
      eventKind: ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_REVOKED,
      before: { role: 'STAFF', accountStatus: 'ACTIVE', requestStatus: null },
      after: { role: null, accountStatus: 'ACTIVE', requestStatus: null },
    },
  });
});
it.each([
  ['STAFF', 'STUDENT', 'STAFF', true, false],
  ['ADMIN', 'STUDENT', 'ADMIN', false, true],
  ['ADMIN', 'STAFF', 'ADMIN', false, true],
] as const)(
  'rejects legacy %s→%s lowering without persisting or auditing',
  async (
    expectedRole,
    desiredRole,
    targetRole,
    hasStaffAccess,
    hasAdminAccess,
  ) => {
    const actor = await harness.createUser(
      `reject-${expectedRole}-${desiredRole}-actor`,
      'ADMIN',
      AccountStatus.ACTIVE,
    );
    const target = await harness.createUser(
      `reject-${expectedRole}-${desiredRole}-target`,
      targetRole,
      AccountStatus.ACTIVE,
    );
    const response = await harness.request(
      'PATCH',
      `/users/${target.id}/access`,
      actor.githubId,
      accessBody({
        expectedRole,
        desiredRole,
      }),
    );
    expect(response.status).toBe(400);
    const body: unknown = await response.json();
    expect(body).toMatchObject({
      status: 400,
      code: RolesErrorCode.INDEPENDENT_AUTHORITY_REQUIRED,
    });
    const staffAccessDetail: unknown = expect.stringContaining(
      '/users/:id/staff-access',
    );
    expect(body).toMatchObject({ detail: staffAccessDetail });
    await expect(
      harness.prisma.user.findUniqueOrThrow({
        include: { admin: true },
        where: { id: target.id },
      }),
    ).resolves.toMatchObject({
      approvalStatus: hasStaffAccess ? 'APPROVED' : 'NOT_REQUIRED',
      admin: hasAdminAccess ? { userId: target.id } : null,
      accountStatus: AccountStatus.ACTIVE,
    });
    await expect(
      requestHistory(harness.prisma, target.id).then((rows) => rows.length),
    ).resolves.toBe(0);
    await expect(
      userAuditRows(harness.prisma, { targetId: target.id }).then(
        (rows) => rows.length,
      ),
    ).resolves.toBe(0);
  },
);
it('deactivates and reactivates through the real route while preserving STAFF role', async () => {
  const actor = await harness.createUser(
    'status-actor',
    'ADMIN',
    AccountStatus.ACTIVE,
  );
  const target = await harness.createUser(
    'status-target',
    'STAFF',
    AccountStatus.ACTIVE,
  );
  const deactivateResponse = await harness.request(
    'PATCH',
    `/users/${target.id}/access`,
    actor.githubId,
    accessBody({
      expectedRole: 'STAFF',
      desiredRole: 'STAFF',
      desiredAccountStatus: AccountStatus.DEACTIVATED,
    }),
  );
  const reactivateResponse = await harness.request(
    'PATCH',
    `/users/${target.id}/access`,
    actor.githubId,
    accessBody({
      expectedRole: 'STAFF',
      desiredRole: 'STAFF',
      expectedAccountStatus: AccountStatus.DEACTIVATED,
      desiredAccountStatus: AccountStatus.ACTIVE,
    }),
  );
  expect(deactivateResponse.status).toBe(200);
  await expect(deactivateResponse.json()).resolves.toMatchObject({
    id: target.id,
    role: 'STAFF',
    accountStatus: AccountStatus.DEACTIVATED,
    pendingRequest: null,
    decidedRequest: null,
  });
  expect(reactivateResponse.status).toBe(200);
  await expect(reactivateResponse.json()).resolves.toMatchObject({
    id: target.id,
    role: 'STAFF',
    accountStatus: AccountStatus.ACTIVE,
    pendingRequest: null,
    decidedRequest: null,
  });
  await expect(
    harness.prisma.user.findUniqueOrThrow({
      include: { admin: true },
      where: { id: target.id },
    }),
  ).resolves.toMatchObject({
    approvalStatus: 'APPROVED',
    admin: null,
    accountStatus: AccountStatus.ACTIVE,
  });
  const logs = await userAuditRows(harness.prisma, { targetId: target.id });
  expect(logs).toHaveLength(2);
  expect(logs[0]).toMatchObject({
    action: ACCESS_AUDIT_ACTIONS.ACCOUNT_STATUS_CHANGED,
    targetType: 'USER',
    targetId: target.id,
    metadata: {
      eventKind: ACCESS_AUDIT_EVENT_KINDS.ACCOUNT_STATUS_CHANGED,
      before: {
        role: 'STAFF',
        accountStatus: AccountStatus.ACTIVE,
        requestStatus: null,
      },
      after: {
        role: 'STAFF',
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
        role: 'STAFF',
        accountStatus: AccountStatus.DEACTIVATED,
        requestStatus: null,
      },
      after: {
        role: 'STAFF',
        accountStatus: AccountStatus.ACTIVE,
        requestStatus: null,
      },
    },
  });
  for (const log of logs) {
    await expect(
      harness.prisma.userHistory.update({
        where: { id: log.id },
        data: { event: 'PHONE_UPDATED' },
      }),
    ).rejects.toThrow();
  }
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
async function pendingScenario(label: string) {
  const actor = await harness.createUser(
    `${label}-actor`,
    'ADMIN',
    AccountStatus.ACTIVE,
  );
  const target = await harness.createUser(
    `${label}-target`,
    null,
    AccountStatus.ACTIVE,
  );
  const requestId = `${target.id}:pending`;
  await writeApprovalFixture(harness.prisma, {
    id: requestId,
    userId: target.id,
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

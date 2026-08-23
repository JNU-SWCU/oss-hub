import {
  AccountStatus,
  LoginHistoryEvent,
  Role,
  StaffAccessRequestStatus,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { AuditLogRepository } from '../audit-log/audit-log.repository';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminAccessRepository } from './admin-access.repository';
import { AdminAccessService } from './admin-access.service';
import {
  ADMIN_ACCESS_PENDING_FILTERS,
  ADMIN_ACCESS_ROLE_FILTERS,
} from './domain/admin-access';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const service = new AdminAccessService(
  new AdminAccessRepository(prisma),
  new AuditLogService(new AuditLogRepository(prisma)),
);
const prefix = 'test:pr03:admin-access-read:';
const queryFragment = 'synthetic-access-read';
let actor: { readonly id: string; readonly githubId: bigint };
let studentPending: { readonly id: string; readonly githubId: bigint };
let studentPlain: { readonly id: string; readonly githubId: bigint };

beforeAll(async () => {
  await prisma.$connect();
  actor = await createUser('actor', 1n, Role.ADMIN, AccountStatus.ACTIVE);
  studentPending = await createUser(
    'student-pending',
    2n,
    Role.STUDENT,
    AccountStatus.ACTIVE,
  );
  await createUser('staff-pending', 3n, Role.STAFF, AccountStatus.ACTIVE);
  await createUser(
    'student-deactivated-pending',
    4n,
    Role.STUDENT,
    AccountStatus.DEACTIVATED,
  );
  studentPlain = await createUser(
    'student-plain',
    5n,
    Role.STUDENT,
    AccountStatus.ACTIVE,
  );
  await prisma.staffAccessRequest.createMany({
    data: [
      pendingRequest(`${prefix}student-pending`),
      pendingRequest(`${prefix}staff-pending`),
      pendingRequest(`${prefix}student-deactivated-pending`),
    ],
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

it('uses DB pagination and computes each facet against the other active filters', async () => {
  // When
  const page = await service.list(actor.githubId, {
    query: queryFragment,
    role: ADMIN_ACCESS_ROLE_FILTERS.STUDENT,
    accountStatus: AccountStatus.ACTIVE,
    pendingRequest: ADMIN_ACCESS_PENDING_FILTERS.PENDING,
    page: 1,
    limit: 1,
  });

  // Then
  expect(page.items).toHaveLength(1);
  expect(page.items[0]?.id).toBe(studentPending.id);
  expect(page.total).toBe(1);
  expect(page.facets).toEqual({
    roles: { unassigned: 0, student: 1, staff: 1, admin: 0 },
    accountStatuses: { active: 1, deactivated: 1 },
    pendingRequests: { none: 1, pending: 1 },
  });
});

it('derives lastLoginAt from the latest successful LOGIN and preserves null', async () => {
  // Given
  const firstLogin = new Date('2026-07-29T00:00:00.000Z');
  const latestLogin = new Date('2026-07-30T00:00:00.000Z');
  await prisma.loginHistory.createMany({
    data: [
      login(
        studentPending.id,
        'first',
        LoginHistoryEvent.LOGIN,
        true,
        firstLogin,
      ),
      login(
        studentPending.id,
        'latest',
        LoginHistoryEvent.LOGIN,
        true,
        latestLogin,
      ),
      login(
        studentPending.id,
        'failed',
        LoginHistoryEvent.LOGIN,
        false,
        new Date('2026-07-31T00:00:00.000Z'),
      ),
      login(
        studentPending.id,
        'logout',
        LoginHistoryEvent.LOGOUT,
        true,
        new Date('2026-07-31T01:00:00.000Z'),
      ),
    ],
  });

  // When
  const [withLogin, withoutLogin] = await Promise.all([
    service.get(actor.githubId, studentPending.id),
    service.get(actor.githubId, studentPlain.id),
  ]);

  // Then
  expect(withLogin.lastLoginAt).toEqual(latestLogin);
  expect(withoutLogin.lastLoginAt).toBeNull();
});

it('returns separately bounded stable history pages using matching deployed indexes', async () => {
  // Given
  const createdAt = new Date('2026-07-28T00:00:00.000Z');
  await prisma.staffAccessRequest.createMany({
    data: [1, 2, 3].map((value) => ({
      id: `${prefix}history-request:${value}`,
      userId: studentPlain.id,
      status: StaffAccessRequestStatus.REJECTED,
      rejectionReason: `합성 반려 ${value}`,
      decidedById: actor.id,
      decidedAt: createdAt,
      createdAt,
    })),
  });
  await prisma.loginHistory.createMany({
    data: [1, 2, 3].map((value) =>
      login(
        studentPlain.id,
        `history-${value}`,
        LoginHistoryEvent.LOGIN,
        true,
        createdAt,
      ),
    ),
  });

  // When
  const history = await service.getHistory(actor.githubId, studentPlain.id, {
    staffAccessRequests: { page: 2, limit: 1 },
    loginHistory: { page: 1, limit: 2 },
  });
  const indexes = await prisma.$queryRaw<readonly { indexname: string }[]>`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'StaffAccessRequest_userId_createdAt_id_idx',
        'StaffAccessRequest_userId_status_createdAt_id_idx',
        'LoginHistory_userId_provider_loginAt_id_idx',
        'LoginHistory_userId_provider_event_success_loginAt_id_idx'
      )
  `;
  const [staffAccessRequestPlan, loginHistoryPlan] = await historyQueryPlans(
    studentPlain.id,
  );

  // Then
  expect(history.staffAccessRequests).toMatchObject({ page: 2, limit: 1, total: 3 });
  expect(history.staffAccessRequests.items).toHaveLength(1);
  expect(history.loginHistory).toMatchObject({ page: 1, limit: 2, total: 3 });
  expect(history.loginHistory.items).toHaveLength(2);
  expect(indexes.map((index) => index.indexname).sort()).toEqual([
    'LoginHistory_userId_provider_event_success_loginAt_id_idx',
    'LoginHistory_userId_provider_loginAt_id_idx',
    'StaffAccessRequest_userId_createdAt_id_idx',
    'StaffAccessRequest_userId_status_createdAt_id_idx',
  ]);
  expect(queryPlanText(staffAccessRequestPlan)).toContain(
    'StaffAccessRequest_userId_createdAt_id_idx',
  );
  expect(queryPlanText(loginHistoryPlan)).toContain(
    'LoginHistory_userId_provider_loginAt_id_idx',
  );
});

type QueryPlanRow = { readonly 'QUERY PLAN': string };

async function historyQueryPlans(
  userId: string,
): Promise<readonly [readonly QueryPlanRow[], readonly QueryPlanRow[]]> {
  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw`SET LOCAL enable_seqscan = off`;
    const staffAccessRequestPlan = await transaction.$queryRaw<
      readonly QueryPlanRow[]
    >`
      EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
      SELECT id
      FROM "StaffAccessRequest"
      WHERE "userId" = ${userId}
      ORDER BY "createdAt" DESC, id DESC
      LIMIT 2
    `;
    const loginHistoryPlan = await transaction.$queryRaw<
      readonly QueryPlanRow[]
    >`
      EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
      SELECT id
      FROM "LoginHistory"
      WHERE "userId" = ${userId}
        AND provider = 'github'
      ORDER BY "loginAt" DESC, id DESC
      LIMIT 2
    `;
    return [staffAccessRequestPlan, loginHistoryPlan];
  });
}

function queryPlanText(plan: readonly QueryPlanRow[]): string {
  return plan.map((row) => row['QUERY PLAN']).join('\n');
}

function createUser(
  label: string,
  suffix: bigint,
  role: Role,
  accountStatus: AccountStatus,
) {
  return prisma.user.create({
    data: {
      id: `${prefix}${label}`,
      githubId: 9_003_800_000n + suffix,
      nickname: `${queryFragment}-${label}`,
      role,
      accountStatus,
    },
    select: { id: true, githubId: true },
  });
}

function pendingRequest(userId: string) {
  return { id: `${userId}:pending`, userId, status: StaffAccessRequestStatus.PENDING };
}

function login(
  userId: string,
  label: string,
  event: LoginHistoryEvent,
  success: boolean,
  loginAt: Date,
) {
  return {
    id: `${userId}:${label}`,
    userId,
    event,
    provider: 'github',
    success,
    loginAt,
  };
}

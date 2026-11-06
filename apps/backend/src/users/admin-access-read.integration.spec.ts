import { writeApprovalFixture } from './user-history.integration-fixture';

import { AdminRepository } from './admin.repository';
import { UserTransitionRepository } from './user-transition.repository';
import { StaffAccessRequestStatus } from './user-contract.config';
import { AdminAccessReadOrderingRepository } from './admin-access-read-ordering.repository';
import { AdminAccessReadRepository } from './admin-access-read.repository';
import { AdminAccessHistoryRepository } from './admin-access-history.repository';
import { canonicalUserCreateFromLabel } from './canonical-user-fixture';
import {
  AccountStatus,
  LoginHistoryEvent,
  PrismaClient,
  type Prisma,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { UserHistoryRepository } from './user-history.repository';
import { PrismaService } from '../platform/prisma.service';
import { AdminAccessRepository } from './admin-access.repository';
import { AdminAccessService } from './admin-access.service';
import {
  ADMIN_ACCESS_PENDING_FILTERS,
  ADMIN_ACCESS_ROLE_FILTERS,
} from './admin-access-query.config';
import { HistoryMetadataService } from '../platform/history-metadata.service';
import { AdminAccessMutationService } from './admin-access-mutation.service';
import { UserProfileService } from './user-profile.service';
assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});
const prisma = new PrismaService();
const service = new AdminAccessService(
  new AdminAccessRepository(
    prisma,
    new AdminAccessHistoryRepository(),
    new AdminAccessReadRepository(new AdminAccessReadOrderingRepository()),
    new AdminRepository(prisma),
    new UserTransitionRepository(),
  ),
  new UserHistoryRepository(new UserTransitionRepository()),
  new AdminAccessMutationService(
    new HistoryMetadataService(),
    new UserProfileService(),
  ),
);
const prefix = 'test:pr03:admin-access-read:';
const queryFragment = 'synthetic-access-read';
let actor: {
  readonly id: string;
  readonly githubId: bigint;
};
const adminPrincipal = () => ({
  githubId: actor.githubId,
  memberKind: null,
  isProfileComplete: false,
  hasStaffAccess: false,
  hasAdminAccess: true,
  accountStatus: AccountStatus.ACTIVE,
});
let studentPending: {
  readonly id: string;
  readonly githubId: bigint;
};
let studentPlain: {
  readonly id: string;
  readonly githubId: bigint;
};
beforeAll(async () => {
  await prisma.$connect();
  actor = await createUser('actor', 1n, 'ADMIN', AccountStatus.ACTIVE);
  studentPending = await createUser(
    'student-pending',
    2n,
    'STUDENT',
    AccountStatus.ACTIVE,
  );
  await createUser('staff-pending', 3n, 'STAFF', AccountStatus.ACTIVE);
  await createUser(
    'student-deactivated-pending',
    4n,
    'STUDENT',
    AccountStatus.DEACTIVATED,
  );
  studentPlain = await createUser(
    'student-plain',
    5n,
    'STUDENT',
    AccountStatus.ACTIVE,
  );
  await createUser('unassigned-plain', 6n, null, AccountStatus.ACTIVE);
  await (async () => {
    for (const request of [
      pendingRequest(`${prefix}student-pending`),
      pendingRequest(`${prefix}staff-pending`),
      pendingRequest(`${prefix}student-deactivated-pending`),
    ])
      await writeApprovalFixture(prisma, request);
  })();
});
afterAll(async () => {
  await prisma.$disconnect();
});
it('uses DB pagination and computes each facet against the other active filters', async () => {
  const page = await service.list(adminPrincipal(), {
    query: queryFragment,
    role: ADMIN_ACCESS_ROLE_FILTERS.UNASSIGNED,
    accountStatus: AccountStatus.ACTIVE,
    pendingRequest: ADMIN_ACCESS_PENDING_FILTERS.PENDING,
    page: 1,
    limit: 1,
  });
  expect(page.items).toHaveLength(1);
  expect(page.items[0]?.id).toBe(`${prefix}staff-pending`);
  expect(page.total).toBe(2);
  expect(page.facets).toEqual({
    roles: { unassigned: 2, student: 0, staff: 0, admin: 0 },
    accountStatuses: { active: 2, deactivated: 1 },
    pendingRequests: { none: 1, pending: 2 },
  });
});
it('derives lastLoginAt from the latest successful LOGIN and preserves null', async () => {
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
  const [withLogin, withoutLogin] = await Promise.all([
    service.get(adminPrincipal(), studentPending.id),
    service.get(adminPrincipal(), studentPlain.id),
  ]);
  expect(withLogin.lastLoginAt).toEqual(latestLogin);
  expect(withoutLogin.lastLoginAt).toBeNull();
});
it('preserves history response pages and explains the actual reader SQL', async () => {
  const createdAt = new Date('2026-07-28T00:00:00.000Z');
  await (async () => {
    for (const request of [1, 2, 3].map((value) => ({
      id: `${prefix}history-request:${value}`,
      userId: studentPlain.id,
      status: StaffAccessRequestStatus.REJECTED,
      rejectionReason: `합성 반려 ${value}`,
      decidedById: actor.id,
      decidedAt: createdAt,
      createdAt,
    })))
      await writeApprovalFixture(prisma, request);
  })();
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
  const history = await service.getHistory(adminPrincipal(), studentPlain.id, {
    staffAccessRequests: { page: 2, limit: 1 },
    loginHistory: { page: 1, limit: 2 },
  });
  const indexes = await prisma.$queryRaw<
    readonly {
      indexname: string;
    }[]
  >`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'UserHistory_userId_occurredAt_id_idx',
        'LoginHistory_userId_provider_loginAt_id_idx',
        'LoginHistory_userId_provider_event_success_loginAt_id_idx'
      )
  `;
  const [staffAccessRequestPlan, loginHistoryPlan] = await historyQueryPlans(
    studentPlain.id,
  );
  expect(history.staffAccessRequests).toMatchObject({
    page: 2,
    limit: 1,
    total: 3,
  });
  expect(history.staffAccessRequests.items).toHaveLength(1);
  expect(history.loginHistory).toMatchObject({ page: 1, limit: 2, total: 3 });
  expect(history.loginHistory.items).toHaveLength(2);
  expect(indexes.map((index) => index.indexname).sort()).toEqual([
    'LoginHistory_userId_provider_event_success_loginAt_id_idx',
    'LoginHistory_userId_provider_loginAt_id_idx',
    'UserHistory_userId_occurredAt_id_idx',
  ]);
  expect(
    staffAccessRequestPlan[0]?.['QUERY PLAN'][0]?.Plan['Actual Rows'],
  ).toBe(3);
  expect(loginHistoryPlan[0]?.['QUERY PLAN'][0]?.Plan['Actual Rows']).toBe(2);
});
type QueryPlanRow = {
  readonly 'QUERY PLAN': readonly {
    readonly Plan: { readonly 'Actual Rows': number };
  }[];
};
async function historyQueryPlans(
  userId: string,
): Promise<readonly [readonly QueryPlanRow[], readonly QueryPlanRow[]]> {
  const reader = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
  const queries: Prisma.QueryEvent[] = [];
  reader.$on('query', (event) => {
    if (event.query.startsWith('SELECT')) queries.push(event);
  });
  try {
    const repository = new AdminAccessHistoryRepository();
    await repository.listAdminAccessStaffAccessRequestHistory(reader, userId, {
      page: 2,
      limit: 1,
    });
    await repository.listAdminAccessLoginHistory(reader, userId, {
      page: 1,
      limit: 2,
    });
    const requestQuery = queries.find((event) =>
      event.query.includes('FROM "public"."UserHistory"'),
    );
    const loginQuery = queries.find(
      (event) =>
        event.query.includes('FROM "public"."LoginHistory"') &&
        !event.query.includes('COUNT('),
    );
    if (!requestQuery || !loginQuery) {
      throw new Error('Actual history reader SELECT queries were not captured');
    }
    return [
      await explainReaderQuery(reader, requestQuery),
      await explainReaderQuery(reader, loginQuery),
    ];
  } finally {
    await reader.$disconnect();
  }
}
async function explainReaderQuery(
  reader: Pick<PrismaClient, '$queryRawUnsafe'>,
  event: Prisma.QueryEvent,
): Promise<readonly QueryPlanRow[]> {
  const parameters: unknown = JSON.parse(event.params);
  if (
    !Array.isArray(parameters) ||
    !parameters.every(
      (value: unknown) =>
        typeof value === 'string' || typeof value === 'number',
    )
  ) {
    throw new Error('Unexpected history reader SQL parameters');
  }
  return reader.$queryRawUnsafe<readonly QueryPlanRow[]>(
    `EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, FORMAT JSON) ${event.query}`,
    ...parameters,
  );
}
function createUser(
  label: string,
  suffix: bigint,
  role: 'STUDENT' | 'STAFF' | 'ADMIN' | null,
  accountStatus: AccountStatus,
) {
  return prisma.user.create({
    data: canonicalUserCreateFromLabel(role, {
      id: `${prefix}${label}`,
      githubId: 9003800000n + suffix,
      nickname: `${queryFragment}-${label}`,
      accountStatus,
    }),
    select: { id: true, githubId: true },
  });
}
function pendingRequest(userId: string) {
  return {
    id: `${userId}:pending`,
    userId,
    status: StaffAccessRequestStatus.PENDING,
  };
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

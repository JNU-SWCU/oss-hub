import { AUTH_SCENARIOS, seedAuth } from './seeds/auth';
import { prisma, seedId, SeedStats } from './seeds/helpers';
import { upsertConsent, upsertSeedProfile, upsertSeedUser } from './seeds/user';
import { AdminAccessHistoryRepository } from '../src/users/admin-access-history.repository';
import { assertIsolatedIntegrationDatabase } from '../test/integration-database.guard';
import { CONSENT_POLICY_VERSION } from '../src/users/consents.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

beforeAll(() => prisma.$connect());
afterAll(() => prisma.$disconnect());

it('keeps auth personas and request snapshots idempotent without granting staff work to administrators', async () => {
  await seedAuth(new SeedStats());
  const before = await Promise.all([
    prisma.user.count({ where: { id: { startsWith: 'seed:auth:' } } }),
    prisma.admin.count({ where: { userId: { startsWith: 'seed:auth:' } } }),
    prisma.userHistory.count({
      where: { userId: { startsWith: 'seed:auth:' } },
    }),
    prisma.adminHistory.count({
      where: { userId: { startsWith: 'seed:auth:' } },
    }),
    prisma.userPolicy.count({
      where: { userId: { startsWith: 'seed:auth:' } },
    }),
  ]);
  await seedAuth(new SeedStats());
  expect(
    await Promise.all([
      prisma.user.count({ where: { id: { startsWith: 'seed:auth:' } } }),
      prisma.admin.count({ where: { userId: { startsWith: 'seed:auth:' } } }),
      prisma.userHistory.count({
        where: { userId: { startsWith: 'seed:auth:' } },
      }),
      prisma.adminHistory.count({
        where: { userId: { startsWith: 'seed:auth:' } },
      }),
      prisma.userPolicy.count({
        where: { userId: { startsWith: 'seed:auth:' } },
      }),
    ]),
  ).toEqual(before);
  const admin = await prisma.user.findUniqueOrThrow({
    where: { id: AUTH_SCENARIOS['admin-confirmed'] },
    include: { admin: true },
  });
  expect(admin).toMatchObject({
    type: 'STAFF',
    approvalStatus: 'PENDING',
    name: '합성 관리자',
    studentId: null,
    departmentType: 'PROGRAM_OFFICE',
    admin: { userId: admin.id, origin: 'BOOTSTRAP' },
  });
  const revocable = await prisma.user.findUniqueOrThrow({
    where: { id: AUTH_SCENARIOS['staff-revocable'] },
  });
  expect(revocable).toMatchObject({
    type: 'STAFF',
    studentId: null,
    departmentType: 'DEPARTMENT',
    approvalStatus: 'APPROVED',
    approvalDecidedById: admin.id,
    accountStatus: 'ACTIVE',
  });
  const revoked = await prisma.user.findUniqueOrThrow({
    where: { id: AUTH_SCENARIOS['staff-revoked'] },
  });
  expect(revoked).toMatchObject({
    type: 'STAFF',
    approvalStatus: 'APPROVED',
    accountStatus: 'DEACTIVATED',
    approvalRequestId: seedId('auth', 'staff-revoked', 'role-request-revoked'),
    approvalDecidedById: null,
    approvalDecidedAt: null,
  });
  const history =
    await new AdminAccessHistoryRepository().listAdminAccessStaffAccessRequestHistory(
      prisma,
      revoked.id,
      { page: 1, limit: 10 },
    );
  expect(history.total).toBe(2);
  expect(history.items.map((row) => row.status)).toEqual([
    'REVOKED',
    'APPROVED',
  ]);
  expect(
    await prisma.userPolicy.count({
      where: { userId: AUTH_SCENARIOS['consent-required'] },
    }),
  ).toBe(0);
});

it('keeps missing profiles missing and preserves the first policy acceptance time', async () => {
  const user = await upsertSeedUser(new SeedStats(), {
    id: 'seed:consolidation:policy',
    role: null,
  });
  expect(user).toMatchObject({
    type: 'UNSELECTED',
    profileCreatedAt: null,
    name: null,
  });
  await upsertConsent(new SeedStats(), user.id);
  const first = await prisma.userPolicy.findUniqueOrThrow({
    where: {
      userId_policyVersion: {
        userId: user.id,
        policyVersion: CONSENT_POLICY_VERSION,
      },
    },
  });
  await upsertConsent(new SeedStats(), user.id);
  expect(
    await prisma.userPolicy.findUniqueOrThrow({
      where: {
        userId_policyVersion: {
          userId: user.id,
          policyVersion: CONSENT_POLICY_VERSION,
        },
      },
    }),
  ).toEqual(first);
});

it('keeps disposable demo initialization free of immutable histories so existing teardown remains possible', async () => {
  const user = await upsertSeedUser(new SeedStats(), {
    id: 'seed:demo:consolidation-check',
    role: 'STAFF',
  });
  await upsertSeedProfile({
    userId: user.id,
    name: '합성 교직원',
    studentId: '262601',
    department: '합성 사업단',
    type: 'STAFF',
  });
  const complete = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
  });
  expect(complete).toMatchObject({
    type: 'STAFF',
    studentId: null,
    approvalStatus: 'APPROVED',
  });
  expect(await prisma.userHistory.count({ where: { userId: user.id } })).toBe(
    0,
  );
  expect(await prisma.adminHistory.count({ where: { userId: user.id } })).toBe(
    0,
  );
  await prisma.user.delete({ where: { id: user.id } });
});

it('clears a synthetic student ID when reseeding a staff persona', async () => {
  const id = seedId('test', 'staff-persona-student-id');
  await upsertSeedUser(new SeedStats(), { id, role: 'STUDENT' });
  await upsertSeedProfile({
    userId: id,
    type: 'STUDENT',
    name: '합성 학생',
    studentId: '923452',
    department: '합성 학과',
    departmentType: 'DEPARTMENT',
  });
  await upsertSeedUser(new SeedStats(), { id, role: 'STAFF' });
  expect(await prisma.user.findUniqueOrThrow({ where: { id } })).toMatchObject({
    type: 'STAFF',
    studentId: null,
  });
  await prisma.user.delete({ where: { id } });
});

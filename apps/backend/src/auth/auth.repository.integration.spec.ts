import {
  requestHistory,
  writeApprovalFixture,
} from '../users/user-history.integration-fixture';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../platform/prisma.service';
import { canonicalUserCreate } from '../users/canonical-user-fixture';
import { AuthRepository } from './auth.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});
const prisma = new PrismaService();
const repository = new AuthRepository(prisma);
const githubId = 9600000000009001n;
const staffGithubId = 9600000000009002n;
const pendingStaffGithubId = 9600000000009003n;
const revokedStaffGithubId = 9600000000009004n;
const rejectedStaffGithubId = 9600000000009005n;
const reapprovedStaffGithubId = 9600000000009006n;
const profile = {
  githubId,
  login: 'synthetic-oauth-user',
  name: 'GitHub 합성 이름',
  avatarUrl: null,
  email: null,
};
function login(id: bigint) {
  return repository.withTransaction((store) =>
    store.upsertUser({
      ...profile,
      githubId: id,
      login: `synthetic-oauth-${id}`,
    }),
  );
}
beforeAll(() => prisma.$connect());
afterAll(() => prisma.$disconnect());

it('동시 최초 로그인은 GitHub 이름을 저장하지 않고 이후 로그인은 사용자 입력 이름을 보존한다', async () => {
  const firstLogins = await Promise.all([
    repository.withTransaction((store) => store.upsertUser(profile)),
    repository.withTransaction((store) => store.upsertUser(profile)),
  ]);
  expect(firstLogins.filter((result) => result.isNew)).toHaveLength(1);
  const user = await prisma.user.findUniqueOrThrow({ where: { githubId } });
  expect(user).toMatchObject({
    name: null,
    profileCreatedAt: null,
    type: 'UNSELECTED',
  });
  await prisma.user.update({
    where: { id: user.id },
    data: {
      type: 'STUDENT',
      name: '사용자 입력 이름',
      studentId: '900001',
      department: '인공지능학부',
      departmentType: 'DEPARTMENT',
      profileCreatedAt: new Date(),
      profileUpdatedAt: new Date(),
    },
  });
  const returning = await repository.withTransaction((store) =>
    store.upsertUser({
      ...profile,
      login: 'synthetic-oauth-user-renamed',
      name: '변경된 GitHub 이름',
    }),
  );
  expect(returning).toMatchObject({
    isNew: false,
    user: {
      nickname: 'synthetic-oauth-user-renamed',
      name: '사용자 입력 이름',
    },
  });
  await expect(
    prisma.userHistory.count({
      where: { userId: user.id, event: 'SIGNED_UP' },
    }),
  ).resolves.toBe(1);
});

it('최초 로그인은 예전 STAFF 시드 대상도 자동 승인하지 않는다', async () => {
  await login(staffGithubId);
  const user = await prisma.user.findUniqueOrThrow({
    where: { githubId: staffGithubId },
    include: { admin: true },
  });
  expect(user).toMatchObject({
    type: 'UNSELECTED',
    approvalStatus: 'NOT_REQUIRED',
    approvalRequestId: null,
    admin: null,
  });
  await expect(requestHistory(prisma, user.id)).resolves.toEqual([]);
});

it.each([
  ['회수', revokedStaffGithubId, 'REVOKED'],
  ['반려', rejectedStaffGithubId, 'REJECTED'],
  ['대기', pendingStaffGithubId, 'PENDING'],
] as const)(
  '%s 계정은 로그인으로 다시 승인되거나 요청이 바뀌지 않는다',
  async (_, id, status) => {
    const user = await prisma.user.create({
      data: canonicalUserCreate({
        id: `test:auth:preserve:${status}`,
        githubId: id,
        nickname: `synthetic-${status}`,
        memberKind: 'STAFF',
      }),
    });
    const request = await writeApprovalFixture(prisma, {
      userId: user.id,
      status,
    });
    const before = await requestHistory(prisma, user.id);
    const result = await login(id);
    expect(result.user).toMatchObject({
      memberKind: 'STAFF',
      approvalStatus: status,
      hasAdminAccess: false,
    });
    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(stored).toMatchObject({
      approvalStatus: status,
      approvalRequestId: request.id,
    });
    await expect(requestHistory(prisma, user.id)).resolves.toEqual(before);
  },
);

it('회수 뒤 다시 승인된 계정은 로그인해도 확정된 승인과 이전 이력을 보존한다', async () => {
  const user = await prisma.user.create({
    data: canonicalUserCreate({
      id: 'test:auth:reapproved',
      githubId: reapprovedStaffGithubId,
      nickname: 'synthetic-reapproved',
      memberKind: 'STAFF',
      hasStaffAccess: true,
    }),
  });
  await writeApprovalFixture(prisma, {
    userId: user.id,
    status: 'REVOKED',
    createdAt: new Date('2026-02-01T00:00:00Z'),
  });
  const approved = await writeApprovalFixture(prisma, {
    userId: user.id,
    status: 'APPROVED',
    createdAt: new Date('2026-02-02T00:00:00Z'),
  });
  const before = await requestHistory(prisma, user.id);
  const result = await login(reapprovedStaffGithubId);
  expect(result.user.approvalStatus).toBe('APPROVED');
  await expect(
    prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
  ).resolves.toMatchObject({
    approvalStatus: 'APPROVED',
    approvalRequestId: approved.id,
  });
  await expect(requestHistory(prisma, user.id)).resolves.toEqual(before);
  expect(before).toHaveLength(2);
});

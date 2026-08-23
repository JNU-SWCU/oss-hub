import { AccountStatus, Role, StaffAccessRequestStatus } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import { AuthConfig } from './auth.config';
import { AuthRepository } from './auth.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const githubId = 9_600_000_000_009_001n;
const staffGithubId = 9_600_000_000_009_002n;
const pendingStaffGithubId = 9_600_000_000_009_003n;
const revokedStaffGithubId = 9_600_000_000_009_004n;
const rejectedStaffGithubId = 9_600_000_000_009_005n;
const reapprovedStaffGithubId = 9_600_000_000_009_006n;
const githubIds = [
  githubId,
  staffGithubId,
  pendingStaffGithubId,
  revokedStaffGithubId,
  rejectedStaffGithubId,
  reapprovedStaffGithubId,
];
const prisma = new PrismaService();

function repositoryWithInitialRole(initialRole: Role | null): AuthRepository {
  const config = {
    resolveInitialRole: jest.fn().mockReturnValue(initialRole),
  } as unknown as AuthConfig;
  return new AuthRepository(prisma, config);
}

function upsertUser(
  repository: AuthRepository,
  profile: {
    readonly githubId: bigint;
    readonly login: string;
    readonly name: string | null;
    readonly avatarUrl: string | null;
    readonly email: string | null;
  },
) {
  return repository.withTransaction((store) => store.upsertUser(profile));
}

async function cleanup(): Promise<void> {
  await prisma.staffAccessRequest.deleteMany({
    where: { user: { githubId: { in: githubIds } } },
  });
  await prisma.user.deleteMany({ where: { githubId: { in: githubIds } } });
}

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

it('동시 최초 로그인은 GitHub 이름을 저장하지 않고 이후 로그인은 UserProfile 이름을 보존한다', async () => {
  const repository = repositoryWithInitialRole(null);
  const profile = {
    githubId,
    login: 'synthetic-oauth-user',
    name: 'GitHub 합성 이름',
    avatarUrl: null,
    email: null,
  };

  const firstLogins = await Promise.all([
    upsertUser(repository, profile),
    upsertUser(repository, profile),
  ]);
  expect(firstLogins.filter((login) => login.isNew)).toHaveLength(1);

  const newUser = await prisma.user.findUniqueOrThrow({
    where: { githubId },
    include: { profile: true },
  });
  expect(newUser.name).toBeNull();
  expect(newUser.profile).toBeNull();

  await prisma.$transaction([
    prisma.user.update({
      where: { githubId },
      data: {
        name: 'Legacy Stale Name',
        studentId: '1'.repeat(6),
        department: 'Legacy Stale Department',
      },
    }),
    prisma.userProfile.create({
      data: {
        userId: newUser.id,
        name: '사용자 입력 이름',
        studentId: '1'.repeat(6),
        department: '인공지능학부',
      },
    }),
  ]);
  const returningLogin = await upsertUser(repository, {
    ...profile,
    login: 'synthetic-oauth-user-renamed',
    name: '변경된 GitHub 이름',
  });

  expect(returningLogin).toMatchObject({
    isNew: false,
    user: {
      nickname: 'synthetic-oauth-user-renamed',
      name: '사용자 입력 이름',
    },
  });
});

it('STAFF 초기 역할 시드는 APPROVED 역할 요청을 함께 만든다', async () => {
  const repository = repositoryWithInitialRole(Role.STAFF);
  await upsertUser(repository, {
    githubId: staffGithubId,
    login: 'synthetic-staff-user',
    name: null,
    avatarUrl: null,
    email: null,
  });

  const user = await prisma.user.findUniqueOrThrow({
    where: { githubId: staffGithubId },
  });
  const requests = await prisma.staffAccessRequest.findMany({
    where: { userId: user.id },
  });
  expect(user.role).toBe(Role.STAFF);
  expect(requests).toHaveLength(1);
  const [approvedRequest] = requests;
  expect(approvedRequest).toMatchObject({
    status: StaffAccessRequestStatus.APPROVED,
    decidedById: null,
  });
  expect(approvedRequest?.decidedAt).not.toBeNull();
});

it('회수 이력이 있는 계정은 초기 역할 시드가 다시 승격하지 않는다', async () => {
  // 회수는 User.role을 비운다. 그래서 회수된 사람은 시드의 `role: null` 조건을
  // 그대로 만족하고, 막지 않으면 다음 로그인 한 번으로 권한이 되살아난다.
  const user = await prisma.user.create({
    data: {
      githubId: revokedStaffGithubId,
      nickname: 'synthetic-revoked-staff-user',
      accountStatus: AccountStatus.ACTIVE,
      role: null,
    },
  });
  const revoked = await prisma.staffAccessRequest.create({
    data: { userId: user.id, status: StaffAccessRequestStatus.REVOKED },
  });
  const repository = repositoryWithInitialRole(Role.STAFF);

  const result = await upsertUser(repository, {
    githubId: revokedStaffGithubId,
    login: 'synthetic-revoked-staff-user',
    name: null,
    avatarUrl: null,
    email: null,
  });

  expect(result.user.role).toBeNull();
  const persisted = await prisma.user.findUniqueOrThrow({
    where: { githubId: revokedStaffGithubId },
  });
  expect(persisted.role).toBeNull();
  // 회수 이력 자체도 그대로여야 한다 — 새 APPROVED 신청이 붙으면 관리자 화면의
  // 결정 이력이 시드가 만든 decidedById=null 행으로 덮인다.
  const requests = await prisma.staffAccessRequest.findMany({
    where: { userId: user.id },
  });
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    id: revoked.id,
    status: StaffAccessRequestStatus.REVOKED,
  });
});

it('반려 이력만 있는 계정은 초기 역할 시드를 그대로 받는다', async () => {
  // 막는 기준은 "이력이 있는가"가 아니라 "회수된 적이 있는가"다.
  const user = await prisma.user.create({
    data: {
      githubId: rejectedStaffGithubId,
      nickname: 'synthetic-rejected-staff-user',
      accountStatus: AccountStatus.ACTIVE,
      role: null,
    },
  });
  await prisma.staffAccessRequest.create({
    data: { userId: user.id, status: StaffAccessRequestStatus.REJECTED },
  });
  const repository = repositoryWithInitialRole(Role.STAFF);

  const result = await upsertUser(repository, {
    githubId: rejectedStaffGithubId,
    login: 'synthetic-rejected-staff-user',
    name: null,
    avatarUrl: null,
    email: null,
  });

  expect(result.user.role).toBe(Role.STAFF);
  const requests = await prisma.staffAccessRequest.findMany({
    where: { userId: user.id },
    orderBy: { status: 'asc' },
  });
  expect(requests.map((request) => request.status)).toEqual([
    StaffAccessRequestStatus.APPROVED,
    StaffAccessRequestStatus.REJECTED,
  ]);
});

it('회수 뒤 다시 승인된 계정은 로그인해도 확정된 역할과 이력이 그대로다', async () => {
  // 재승인된 사람은 role이 채워져 있어 시드 블록에 들어오지 않는다.
  // 회수 이력이 남아 있다는 이유로 그의 권한이 흔들리지 않는지 못 박아 둔다.
  const user = await prisma.user.create({
    data: {
      githubId: reapprovedStaffGithubId,
      nickname: 'synthetic-reapproved-staff-user',
      accountStatus: AccountStatus.ACTIVE,
      role: Role.STAFF,
    },
  });
  await prisma.staffAccessRequest.create({
    data: { userId: user.id, status: StaffAccessRequestStatus.REVOKED },
  });
  await prisma.staffAccessRequest.create({
    data: { userId: user.id, status: StaffAccessRequestStatus.APPROVED },
  });
  const repository = repositoryWithInitialRole(Role.STAFF);

  const result = await upsertUser(repository, {
    githubId: reapprovedStaffGithubId,
    login: 'synthetic-reapproved-staff-user',
    name: null,
    avatarUrl: null,
    email: null,
  });

  expect(result.user.role).toBe(Role.STAFF);
  const requests = await prisma.staffAccessRequest.findMany({
    where: { userId: user.id },
  });
  expect(requests).toHaveLength(2);
});

it('기존 PENDING 역할 요청은 STAFF 초기 역할 시드에서 새로 만들지 않고 전이한다', async () => {
  const user = await prisma.user.create({
    data: {
      githubId: pendingStaffGithubId,
      nickname: 'synthetic-pending-staff-user',
      accountStatus: AccountStatus.ACTIVE,
    },
  });
  const pending = await prisma.staffAccessRequest.create({
    data: { userId: user.id, status: StaffAccessRequestStatus.PENDING },
  });
  const repository = repositoryWithInitialRole(Role.STAFF);

  await upsertUser(repository, {
    githubId: pendingStaffGithubId,
    login: 'synthetic-pending-staff-user',
    name: null,
    avatarUrl: null,
    email: null,
  });

  const requests = await prisma.staffAccessRequest.findMany({
    where: { userId: user.id },
  });
  expect(requests).toHaveLength(1);
  const [transitionedRequest] = requests;
  expect(transitionedRequest).toMatchObject({
    id: pending.id,
    status: StaffAccessRequestStatus.APPROVED,
    decidedById: null,
  });
  expect(transitionedRequest?.decidedAt).not.toBeNull();
});

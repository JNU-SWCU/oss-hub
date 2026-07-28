import { AccountStatus, Role, RoleRequestStatus } from '@prisma/client';
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
const githubIds = [githubId, staffGithubId, pendingStaffGithubId];
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
  await prisma.roleRequest.deleteMany({
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

it('동시 최초 로그인은 신규 1건으로 수렴하고 이후 로그인은 온보딩 이름을 보존한다', async () => {
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

  await prisma.user.update({
    where: { githubId },
    data: { name: '사용자 입력 이름' },
  });
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
  const requests = await prisma.roleRequest.findMany({
    where: { userId: user.id },
  });
  expect(user.role).toBe(Role.STAFF);
  expect(requests).toHaveLength(1);
  const [approvedRequest] = requests;
  expect(approvedRequest).toMatchObject({
    status: RoleRequestStatus.APPROVED,
    decidedById: null,
  });
  expect(approvedRequest?.decidedAt).not.toBeNull();
});

it('기존 PENDING 역할 요청은 STAFF 초기 역할 시드에서 새로 만들지 않고 전이한다', async () => {
  const user = await prisma.user.create({
    data: {
      githubId: pendingStaffGithubId,
      nickname: 'synthetic-pending-staff-user',
      accountStatus: AccountStatus.ACTIVE,
    },
  });
  const pending = await prisma.roleRequest.create({
    data: { userId: user.id, status: RoleRequestStatus.PENDING },
  });
  const repository = repositoryWithInitialRole(Role.STAFF);

  await upsertUser(repository, {
    githubId: pendingStaffGithubId,
    login: 'synthetic-pending-staff-user',
    name: null,
    avatarUrl: null,
    email: null,
  });

  const requests = await prisma.roleRequest.findMany({
    where: { userId: user.id },
  });
  expect(requests).toHaveLength(1);
  const [transitionedRequest] = requests;
  expect(transitionedRequest).toMatchObject({
    id: pending.id,
    status: RoleRequestStatus.APPROVED,
    decidedById: null,
  });
  expect(transitionedRequest?.decidedAt).not.toBeNull();
});

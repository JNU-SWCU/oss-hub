import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import { AuthRepository } from './auth.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const githubId = 9_600_000_000_009_001n;
const prisma = new PrismaService();
const repository = new AuthRepository(prisma);

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await prisma.user.deleteMany({ where: { githubId } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { githubId } });
  await prisma.$disconnect();
});

it('동시 최초 로그인은 신규 1건으로 수렴하고 이후 로그인은 온보딩 이름을 보존한다', async () => {
  const profile = {
    githubId,
    login: 'synthetic-oauth-user',
    name: 'GitHub 합성 이름',
    avatarUrl: null,
  };

  const firstLogins = await Promise.all([
    repository.upsertUser(profile),
    repository.upsertUser(profile),
  ]);
  expect(firstLogins.filter((login) => login.isNew)).toHaveLength(1);

  await prisma.user.update({
    where: { githubId },
    data: { name: '사용자 입력 이름' },
  });
  const returningLogin = await repository.upsertUser({
    ...profile,
    login: 'synthetic-oauth-user-renamed',
    name: '변경된 GitHub 이름',
  });

  expect(returningLogin).toMatchObject({
    isNew: false,
    user: {
      login: 'synthetic-oauth-user-renamed',
      name: '사용자 입력 이름',
    },
  });
});

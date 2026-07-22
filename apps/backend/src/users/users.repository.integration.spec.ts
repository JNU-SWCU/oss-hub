import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import { UsersRepository } from './users.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const userId = 'test:users:profile';
const githubId = 9_600_000_000_153_001n;
const firstProfile = {
  name: '합성 최초 사용자',
  studentId: '1'.repeat(6),
  department: '인공지능학부',
};
const secondProfile = {
  name: '합성 덮어쓰기 사용자',
  studentId: '2'.repeat(6),
  department: '소프트웨어공학과',
};

const prisma = new PrismaService();
const repository = new UsersRepository(prisma);

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.user.create({
    data: {
      id: userId,
      githubId,
      login: 'synthetic-profile-user',
      name: 'GitHub 합성 이름',
    },
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

it('학번·학과를 DB에 저장하고 다시 조회한다', async () => {
  await expect(
    repository.completeProfileIfIncomplete(userId, firstProfile),
  ).resolves.toBe(true);

  await expect(repository.findByGithubId(githubId)).resolves.toEqual({
    id: userId,
    ...firstProfile,
  });
});

it('완료된 프로필은 두 번째 요청으로 덮어쓰지 않는다', async () => {
  await repository.completeProfileIfIncomplete(userId, firstProfile);

  await expect(
    repository.completeProfileIfIncomplete(userId, secondProfile),
  ).resolves.toBe(false);
  await expect(repository.findByGithubId(githubId)).resolves.toMatchObject(
    firstProfile,
  );
});

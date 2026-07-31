import { Role } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import { AdminUsersRepository } from './admin-users.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const TEST_PREFIX = 'test:admin-users:ordering:';
const prisma = new PrismaService();
const repository = new AdminUsersRepository(prisma);

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await prisma.user.deleteMany({
    where: { id: { startsWith: TEST_PREFIX } },
  });
  await prisma.user.createMany({
    data: [
      {
        id: `${TEST_PREFIX}profile-first`,
        githubId: 9_600_000_000_153_301n,
        nickname: 'synthetic-ordering-profile',
        name: 'Zulu Legacy',
        role: Role.STUDENT,
      },
      {
        id: `${TEST_PREFIX}legacy-fallback`,
        githubId: 9_600_000_000_153_302n,
        nickname: 'synthetic-ordering-legacy',
        name: 'Beta Legacy',
        role: Role.STUDENT,
      },
    ],
  });
  await prisma.userProfile.create({
    data: {
      userId: `${TEST_PREFIX}profile-first`,
      name: 'Alpha Profile',
      studentId: '153301',
      department: 'Synthetic Department',
    },
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({
    where: { id: { startsWith: TEST_PREFIX } },
  });
  await prisma.$disconnect();
});

it('표시되는 profile-first 이름을 기준으로 관리자 사용자 목록을 정렬한다', async () => {
  // Given
  const query = { query: 'synthetic-ordering', role: undefined };

  // When
  const users = await repository.list(query);

  // Then
  expect(users.map((user) => user.name)).toEqual([
    'Alpha Profile',
    'Beta Legacy',
  ]);
});

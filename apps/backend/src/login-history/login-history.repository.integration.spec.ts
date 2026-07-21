import { PrismaService } from '../prisma/prisma.service';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { LOGIN_HISTORY_EVENTS } from './domain/login-history';
import { LoginHistoryRepository } from './login-history.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const DATABASE_CONNECTION_TIMEOUT_MS = 60_000;
const firstGithubId = 9_000_000_000_000_157n;
const secondGithubId = 9_000_000_000_000_158n;

describe('LoginHistoryRepository integration', () => {
  const prisma = new PrismaService();
  const repository = new LoginHistoryRepository(prisma);
  let firstUserId: string;
  let secondUserId: string;

  beforeAll(async () => {
    await prisma.$connect();
    const [firstUser, secondUser] = await Promise.all([
      prisma.user.create({
        data: { githubId: firstGithubId, login: 'synthetic-history-one' },
      }),
      prisma.user.create({
        data: { githubId: secondGithubId, login: 'synthetic-history-two' },
      }),
    ]);
    firstUserId = firstUser.id;
    secondUserId = secondUser.id;
  }, DATABASE_CONNECTION_TIMEOUT_MS);

  afterEach(async () => {
    await prisma.loginHistory.deleteMany({
      where: { userId: { in: [firstUserId, secondUserId] } },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { githubId: { in: [firstGithubId, secondGithubId] } },
    });
    await prisma.$disconnect();
  });

  it('로그인과 로그아웃을 provider 고정값으로 저장한다', async () => {
    // Given: 로그인한 사용자가 있다.

    // When: 로그인과 로그아웃을 차례로 기록한다.
    await repository.create(firstUserId, LOGIN_HISTORY_EVENTS.LOGIN);
    await repository.create(firstUserId, LOGIN_HISTORY_EVENTS.LOGOUT);

    // Then: GitHub provider의 성공 이력 두 건이 저장된다.
    const rows = await prisma.loginHistory.findMany({
      where: { userId: firstUserId },
    });
    expect(rows).toHaveLength(2);
    expect(
      rows.map(({ event, provider, success }) => ({
        event,
        provider,
        success,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          event: LOGIN_HISTORY_EVENTS.LOGIN,
          provider: 'github',
          success: true,
        },
        {
          event: LOGIN_HISTORY_EVENTS.LOGOUT,
          provider: 'github',
          success: true,
        },
      ]),
    );
  });

  it('요청한 사용자 이력만 최신순으로 페이지 조회한다', async () => {
    // Given: 두 사용자의 이력이 섞여 있다.
    await prisma.loginHistory.createMany({
      data: [
        {
          userId: firstUserId,
          event: LOGIN_HISTORY_EVENTS.LOGIN,
          success: true,
          loginAt: new Date('2026-07-21T00:00:00.000Z'),
        },
        {
          userId: firstUserId,
          event: LOGIN_HISTORY_EVENTS.LOGOUT,
          success: true,
          loginAt: new Date('2026-07-21T00:01:00.000Z'),
        },
        {
          userId: secondUserId,
          event: LOGIN_HISTORY_EVENTS.LOGIN,
          success: true,
          loginAt: new Date('2026-07-21T00:02:00.000Z'),
        },
      ],
    });

    // When: 첫 번째 사용자의 두 번째 페이지를 조회한다.
    const result = await repository.findPage(firstUserId, 2, 1);

    // Then: 다른 사용자는 제외하고 첫 번째 사용자의 이전 이력만 반환한다.
    expect(result.total).toBe(2);
    expect(result.page).toBe(2);
    expect(result.size).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.event).toBe(LOGIN_HISTORY_EVENTS.LOGIN);
  });
});

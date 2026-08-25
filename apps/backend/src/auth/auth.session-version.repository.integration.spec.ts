import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthConfig } from './auth.config';
import { AuthRepository } from './auth.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const githubId = 9_600_000_000_009_101n;
const prisma = new PrismaService();
const repository = new AuthRepository(prisma, {
  resolveInitialRole: jest.fn().mockReturnValue(null),
} as unknown as AuthConfig);

type SessionVersionRow = {
  readonly sessionVersion: number;
};

async function cleanup(): Promise<void> {
  await prisma.user.deleteMany({ where: { githubId } });
}

async function createSyntheticUser(): Promise<void> {
  await prisma.user.create({
    data: {
      githubId,
      nickname: 'synthetic-session-version-user',
    },
  });
}

async function readSessionVersion(): Promise<number> {
  const [row] = await prisma.$queryRaw<SessionVersionRow[]>`
    SELECT "sessionVersion"
    FROM "User"
    WHERE "githubId" = ${githubId}
  `;
  if (row === undefined) {
    throw new Error('Synthetic session-version user was not found');
  }
  return row.sessionVersion;
}

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

it('격리된 repository fixture는 합성 사용자 한 명만 만든다', async () => {
  await createSyntheticUser();

  await expect(repository.findByGithubId(githubId)).resolves.toMatchObject({
    githubId,
  });
});

it('동시 세션 세대 증가는 모두 누적되어 이전 세대를 보존하지 않는다', async () => {
  await createSyntheticUser();
  const oldGeneration = await readSessionVersion();

  let arrived = 0;
  let releaseArrived: () => void = () => undefined;
  const allArrived = new Promise<void>((resolve) => {
    releaseArrived = resolve;
  });
  let releaseStart: () => void = () => undefined;
  const start = new Promise<void>((resolve) => {
    releaseStart = resolve;
  });
  const incrementAtBarrier = async (): Promise<unknown> => {
    arrived += 1;
    if (arrived === 2) {
      releaseArrived();
    }
    await start;
    return repository.incrementSessionVersion(githubId);
  };

  const increments = [incrementAtBarrier(), incrementAtBarrier()];
  await allArrived;
  releaseStart();
  await Promise.all(increments);
  const liveGeneration = await readSessionVersion();

  expect(liveGeneration).toBe(oldGeneration + 2);
  expect(liveGeneration).not.toBe(oldGeneration);
});

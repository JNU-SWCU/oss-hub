import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { CollectionRepository } from './collection.repository';
import { CollectionRunStarter } from './collection-run-starter.service';
import {
  COLLECTION_RUN_STATUSES,
  COLLECTION_RUN_START_KINDS,
  COLLECTION_TRIGGERS,
} from './domain/collection-run';
import type { CollectionUser } from './domain/collection-run';

const TEST_DATABASE_URL =
  'postgresql://oss:oss-dev@localhost:5432/oss_hub';
process.env.DATABASE_URL ??= TEST_DATABASE_URL;

const backendDirectory = resolve(__dirname, '../..');
const composeFile = resolve(__dirname, '../../../../compose.dev.yml');
const prismaExecutable = join(
  backendDirectory,
  'node_modules/.bin/prisma',
);

const parallelUser: CollectionUser = {
  githubId: 9_000_000_000_000_001n,
  login: 'synthetic-parallel-user',
};

const runningUser: CollectionUser = {
  githubId: 9_000_000_000_000_002n,
  login: 'synthetic-running-user',
};

const cooledDownUser: CollectionUser = {
  githubId: 9_000_000_000_000_003n,
  login: 'synthetic-cooled-down-user',
};

const cooldownUser: CollectionUser = {
  githubId: 9_000_000_000_000_004n,
  login: 'synthetic-cooldown-user',
};

const rateLimitedUser: CollectionUser = {
  githubId: 9_000_000_000_000_005n,
  login: 'synthetic-rate-limited-user',
};

const constraintUser: CollectionUser = {
  githubId: 9_000_000_000_000_006n,
  login: 'synthetic-constraint-user',
};

describe('CollectionRunStarter integration', () => {
  const prisma = new PrismaService();
  const repository = new CollectionRepository(prisma);
  const runStarter = new CollectionRunStarter(repository);
  const syntheticGithubIds = [
    parallelUser.githubId,
    runningUser.githubId,
    cooledDownUser.githubId,
    cooldownUser.githubId,
    rateLimitedUser.githubId,
    constraintUser.githubId,
  ];

  beforeAll(async () => {
    execFileSync(
      'docker',
      ['compose', '-p', 'oss-hub', '-f', composeFile, 'up', '-d', '--wait'],
      { stdio: 'pipe' },
    );
    execFileSync(prismaExecutable, ['migrate', 'deploy'], {
      cwd: backendDirectory,
      env: process.env,
      stdio: 'pipe',
    });
    await prisma.$connect();
  });

  afterEach(async () => {
    await prisma.collectionRun.deleteMany({
      where: { targetGithubId: { in: syntheticGithubIds } },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('동일 사용자의 병렬 시작 요청은 RUNNING 한 건만 만든다', async () => {
    // Given: 동일 사용자에게 활성 run이 없다.

    // When: 두 시작 요청이 동시에 도착한다.
    const results = await Promise.all([
      runStarter.start(parallelUser, COLLECTION_TRIGGERS.SELF),
      runStarter.start(parallelUser, COLLECTION_TRIGGERS.SELF),
    ]);

    // Then: DB에는 RUNNING 한 건만 존재한다.
    const runningCount = await prisma.collectionRun.count({
      where: {
        targetGithubId: parallelUser.githubId,
        status: COLLECTION_RUN_STATUSES.RUNNING,
      },
    });
    expect(results.map((result) => result.kind).sort()).toEqual([
      COLLECTION_RUN_START_KINDS.REJECTED,
      COLLECTION_RUN_START_KINDS.STARTED,
    ]);
    expect(runningCount).toBe(1);
  });

  it('이미 RUNNING인 사용자의 두 번째 시작 요청은 새 run을 만들지 않는다', async () => {
    // Given: 동일 사용자의 RUNNING run이 이미 있다.
    await prisma.collectionRun.create({
      data: {
        targetGithubId: runningUser.githubId,
        targetLogin: runningUser.login,
        trigger: COLLECTION_TRIGGERS.SELF,
        status: COLLECTION_RUN_STATUSES.RUNNING,
      },
    });

    // When: 두 번째 시작 요청이 도착한다.
    const result = await runStarter.start(
      runningUser,
      COLLECTION_TRIGGERS.SELF,
    );

    // Then: DB의 run 수는 늘지 않는다.
    const runCount = await prisma.collectionRun.count({
      where: { targetGithubId: runningUser.githubId },
    });
    expect(result.kind).toBe(COLLECTION_RUN_START_KINDS.REJECTED);
    expect(runCount).toBe(1);
  });

  it('cooldown이 지난 사용자는 새 run을 시작할 수 있다', async () => {
    // Given: 직전 run의 시작 시각이 충분히 오래됐다.
    await prisma.collectionRun.create({
      data: {
        targetGithubId: cooledDownUser.githubId,
        targetLogin: cooledDownUser.login,
        trigger: COLLECTION_TRIGGERS.SELF,
        status: COLLECTION_RUN_STATUSES.SUCCEEDED,
        startedAt: new Date('2020-01-01T00:00:00.000Z'),
        finishedAt: new Date('2020-01-01T00:00:01.000Z'),
      },
    });

    // When: 새 시작 요청이 도착한다.
    const result = await runStarter.start(
      cooledDownUser,
      COLLECTION_TRIGGERS.SELF,
    );

    // Then: 새 RUNNING run이 생성된다.
    const runningCount = await prisma.collectionRun.count({
      where: {
        targetGithubId: cooledDownUser.githubId,
        status: COLLECTION_RUN_STATUSES.RUNNING,
      },
    });
    expect(result.kind).toBe(COLLECTION_RUN_START_KINDS.STARTED);
    expect(runningCount).toBe(1);
  });

  it('cooldown 안의 사용자는 새 run을 시작할 수 없다', async () => {
    // Given: 직전 run이 방금 완료됐다.
    await prisma.collectionRun.create({
      data: {
        targetGithubId: cooldownUser.githubId,
        targetLogin: cooldownUser.login,
        trigger: COLLECTION_TRIGGERS.SELF,
        status: COLLECTION_RUN_STATUSES.SUCCEEDED,
        finishedAt: new Date(),
      },
    });

    // When: 즉시 새 시작 요청이 도착한다.
    const result = await runStarter.start(
      cooldownUser,
      COLLECTION_TRIGGERS.SELF,
    );

    // Then: 새 run이 생기지 않고 재시도 시각이 반환된다.
    const runCount = await prisma.collectionRun.count({
      where: { targetGithubId: cooldownUser.githubId },
    });
    expect(result.kind).toBe(COLLECTION_RUN_START_KINDS.REJECTED);
    expect(runCount).toBe(1);
  });

  it('GitHub rate limit 재시도 시각 전에는 새 run을 시작할 수 없다', async () => {
    // Given: cooldown은 지났지만 GitHub rate limit 재시도 시각은 남아 있다.
    const retryNotBeforeAt = new Date(Date.now() + 60 * 60 * 1_000);
    await prisma.collectionRun.create({
      data: {
        targetGithubId: rateLimitedUser.githubId,
        targetLogin: rateLimitedUser.login,
        trigger: COLLECTION_TRIGGERS.SELF,
        status: COLLECTION_RUN_STATUSES.RATE_LIMITED,
        retryNotBeforeAt,
        startedAt: new Date('2020-01-01T00:00:00.000Z'),
        finishedAt: new Date('2020-01-01T00:00:01.000Z'),
      },
    });

    // When: 새 시작 요청이 도착한다.
    const result = await runStarter.start(
      rateLimitedUser,
      COLLECTION_TRIGGERS.SELF,
    );

    // Then: GitHub 재시도 시각을 지키며 새 run을 만들지 않는다.
    const runCount = await prisma.collectionRun.count({
      where: { targetGithubId: rateLimitedUser.githubId },
    });
    expect(result).toEqual({
      kind: COLLECTION_RUN_START_KINDS.REJECTED,
      retryNotBeforeAt,
    });
    expect(runCount).toBe(1);
  });

  it('repository gate를 우회해도 DB가 사용자별 RUNNING 한 건만 허용한다', async () => {
    // Given: repository 밖 writer가 RUNNING run을 직접 만들었다.
    const runData = {
      targetGithubId: constraintUser.githubId,
      targetLogin: constraintUser.login,
      trigger: COLLECTION_TRIGGERS.SELF,
      status: COLLECTION_RUN_STATUSES.RUNNING,
    };
    await prisma.collectionRun.create({ data: runData });

    // When: 같은 사용자의 두 번째 RUNNING insert가 gate를 우회한다.
    const duplicateInsert = prisma.collectionRun.create({ data: runData });

    // Then: partial unique index가 DB 경계에서 거부한다.
    await expect(duplicateInsert).rejects.toMatchObject({ code: 'P2002' });
  });
});

import { PrismaService } from '../prisma/prisma.service';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { CollectionRepository } from './collection.repository';
import { CollectionRunStarter } from './collection-run-starter.service';
import {
  COLLECTION_RUN_STATUSES,
  COLLECTION_RUN_START_KINDS,
  COLLECTION_TRIGGERS,
} from './domain/collection-run';
import type { CollectionUser } from './domain/collection-run';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const DATABASE_CONNECTION_TIMEOUT_MS = 60_000;
const RECOVERY_FINISHED_AT = new Date('2026-01-01T00:30:00.000Z');

const staleUser: CollectionUser = {
  githubId: 9_000_000_000_000_101n,
  login: 'synthetic-stale-user',
};

const successFenceUser: CollectionUser = {
  githubId: 9_000_000_000_000_102n,
  login: 'synthetic-success-fence-user',
};

const rateLimitFenceUser: CollectionUser = {
  githubId: 9_000_000_000_000_103n,
  login: 'synthetic-rate-limit-fence-user',
};

const failureFenceUser: CollectionUser = {
  githubId: 9_000_000_000_000_104n,
  login: 'synthetic-failure-fence-user',
};

describe('CollectionRun stale recovery integration', () => {
  const prisma = new PrismaService();
  const repository = new CollectionRepository(prisma);
  const runStarter = new CollectionRunStarter(repository);
  const syntheticGithubIds = [
    staleUser.githubId,
    successFenceUser.githubId,
    rateLimitFenceUser.githubId,
    failureFenceUser.githubId,
  ];

  beforeAll(async () => {
    await prisma.$connect();
  }, DATABASE_CONNECTION_TIMEOUT_MS);

  afterEach(async () => {
    const runs = await prisma.collectionRun.findMany({
      where: { targetGithubId: { in: syntheticGithubIds } },
      select: { id: true },
    });
    await prisma.githubRawObservation.deleteMany({
      where: { runId: { in: runs.map(({ id }) => id) } },
    });
    await prisma.collectionRun.deleteMany({
      where: { targetGithubId: { in: syntheticGithubIds } },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('30분을 넘긴 RUNNING을 실패 처리하고 새 run을 시작한다', async () => {
    // Given: 회수 기준보다 오래된 RUNNING이 있다.
    const staleRun = await prisma.collectionRun.create({
      data: {
        targetGithubId: staleUser.githubId,
        targetLogin: staleUser.login,
        trigger: COLLECTION_TRIGGERS.SELF,
        status: COLLECTION_RUN_STATUSES.RUNNING,
        startedAt: new Date('2020-01-01T00:00:00.000Z'),
      },
    });

    // When: 같은 사용자의 다음 시작 요청이 도착한다.
    const result = await runStarter.start(staleUser, COLLECTION_TRIGGERS.SELF);

    // Then: 이전 run은 FAILED가 되고 새 RUNNING 한 건이 생긴다.
    const recoveredRun = await prisma.collectionRun.findUniqueOrThrow({
      where: { id: staleRun.id },
    });
    const runningCount = await prisma.collectionRun.count({
      where: {
        targetGithubId: staleUser.githubId,
        status: COLLECTION_RUN_STATUSES.RUNNING,
      },
    });
    expect(result.kind).toBe(COLLECTION_RUN_START_KINDS.STARTED);
    expect(recoveredRun).toMatchObject({
      status: COLLECTION_RUN_STATUSES.FAILED,
    });
    expect(recoveredRun.finishedAt).toBeInstanceOf(Date);
    expect(runningCount).toBe(1);
  });

  it('회수된 run의 늦은 성공은 상태와 observation을 덮어쓰지 않는다', async () => {
    // Given: 이미 회수되어 FAILED인 run이 있다.
    const recoveredRun = await prisma.collectionRun.create({
      data: {
        targetGithubId: successFenceUser.githubId,
        targetLogin: successFenceUser.login,
        trigger: COLLECTION_TRIGGERS.SELF,
        status: COLLECTION_RUN_STATUSES.FAILED,
        startedAt: new Date('2020-01-01T00:00:00.000Z'),
        finishedAt: RECOVERY_FINISHED_AT,
      },
    });

    // When: 이전 worker가 뒤늦게 성공 저장을 시도한다.
    const result = await repository.markSucceeded({
      runId: recoveredRun.id,
      profiles: [{ sourceId: '101', payload: { id: 101 } }],
      repositories: [{ sourceId: '102', payload: { id: 102 } }],
      events: [{ sourceId: '103', payload: { id: 103 } }],
    });

    // Then: 회수 상태와 시각이 유지되고 observation은 저장되지 않는다.
    const observationCount = await prisma.githubRawObservation.count({
      where: { runId: recoveredRun.id },
    });
    expect(result).toMatchObject({
      status: COLLECTION_RUN_STATUSES.FAILED,
      profileCount: 0,
      repoCount: 0,
      eventCount: 0,
      finishedAt: RECOVERY_FINISHED_AT,
    });
    expect(observationCount).toBe(0);
  });

  it('회수된 run의 늦은 rate limit은 상태와 시각을 덮어쓰지 않는다', async () => {
    // Given: 이미 회수되어 FAILED인 run이 있다.
    const recoveredRun = await prisma.collectionRun.create({
      data: {
        targetGithubId: rateLimitFenceUser.githubId,
        targetLogin: rateLimitFenceUser.login,
        trigger: COLLECTION_TRIGGERS.SELF,
        status: COLLECTION_RUN_STATUSES.FAILED,
        startedAt: new Date('2020-01-01T00:00:00.000Z'),
        finishedAt: RECOVERY_FINISHED_AT,
      },
    });

    // When: 이전 worker가 뒤늦게 rate-limit 저장을 시도한다.
    const result = await repository.markRateLimited(
      recoveredRun.id,
      new Date('2026-01-01T01:00:00.000Z'),
    );

    // Then: 회수 상태·시각·retry 필드가 그대로 유지된다.
    expect(result).toMatchObject({
      status: COLLECTION_RUN_STATUSES.FAILED,
      retryNotBeforeAt: null,
      finishedAt: RECOVERY_FINISHED_AT,
    });
  });

  it('종료된 run의 늦은 실패는 기존 종료 상태와 시각을 덮어쓰지 않는다', async () => {
    // Given: 이미 SUCCEEDED로 종료된 run이 있다.
    const succeededRun = await prisma.collectionRun.create({
      data: {
        targetGithubId: failureFenceUser.githubId,
        targetLogin: failureFenceUser.login,
        trigger: COLLECTION_TRIGGERS.SELF,
        status: COLLECTION_RUN_STATUSES.SUCCEEDED,
        startedAt: new Date('2020-01-01T00:00:00.000Z'),
        finishedAt: RECOVERY_FINISHED_AT,
      },
    });

    // When: 같은 worker 경로가 뒤늦게 실패 저장을 시도한다.
    const result = await repository.markFailed(succeededRun.id);

    // Then: 기존 종료 상태와 시각이 그대로 유지된다.
    expect(result).toMatchObject({
      status: COLLECTION_RUN_STATUSES.SUCCEEDED,
      finishedAt: RECOVERY_FINISHED_AT,
    });
  });
});

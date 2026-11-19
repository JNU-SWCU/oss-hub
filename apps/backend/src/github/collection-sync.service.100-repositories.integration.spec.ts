import {
  APP_ID,
  ORG_LOGIN,
  SCOPE,
  REPO_COUNT,
  FIRST_REPO_ID,
  BUSY_INDEX,
  HOUR,
  SKEW_MS,
  RUN_1,
  RUN_2,
  RUN_3,
  RUN_4,
  contributorId,
  expectedContributionCount,
  createScaleCollectionFixture,
} from './collection-scale.integration-support';

type ScaleFixture = Awaited<ReturnType<typeof createScaleCollectionFixture>>;

const CASE_TIMEOUT_MS = 30_000;

describe('CollectionSyncService — 저장소 100개 probe/collect (실 DB)', () => {
  let fixture: ScaleFixture | undefined;
  let pendingTest: Promise<void> | undefined;

  beforeEach(async () => {
    fixture = undefined;
    pendingTest = undefined;
    fixture = await createScaleCollectionFixture();
  }, 90_000);

  afterEach(async () => {
    if (pendingTest) await Promise.allSettled([pendingTest]);
    await fixture?.close();
  }, 60_000);

  const itWithFixture = (
    name: string,
    body: (fixture: ScaleFixture) => Promise<void>,
  ) =>
    it(
      name,
      () => {
        if (!fixture) throw new Error('scale fixture was not initialized');
        pendingTest = body(fixture);
        return pendingTest;
      },
      CASE_TIMEOUT_MS,
    );

  itWithFixture(
    '첫 실행은 probe 1번과 저장소당 수집 1번(100건 초과 저장소만 1번 더)으로 모든 기여를 한 번씩 넣는다',
    async ({ seeds, provider, runAt, contributionCount, lastSuccessAts }) => {
      const summary = await runAt(RUN_1);

      expect(provider.counters.byKind).toEqual({
        probe: 1,
        collect: REPO_COUNT + 1,
        repository: 0,
      });
      expect(
        provider.counters.byRepository.get(`${ORG_LOGIN}/repo-${BUSY_INDEX}`),
      ).toEqual({ collect: 2 });
      await expect(contributionCount()).resolves.toBe(
        expectedContributionCount(seeds),
      );
      const successes = await lastSuccessAts();
      expect([...successes.values()]).toEqual(
        Array.from(
          { length: REPO_COUNT },
          () => new Date(RUN_1.getTime() - SKEW_MS),
        ),
      );
      expect(summary).toMatchObject({
        kind: 'hourly',
        repos: REPO_COUNT,
        probeRequests: 1,
        collectedRepos: REPO_COUNT,
        requests: REPO_COUNT + 2,
        inserted: expectedContributionCount(seeds),
      });
    },
  );

  itWithFixture(
    '활동이 없는 다음 실행은 probe 1번만 보내고 원장에 쓰지 않으며 last_success_at만 올린다',
    async ({ provider, runAt, contributionCount, lastSuccessAts }) => {
      await runAt(RUN_1);
      const before = await contributionCount();

      const summary = await runAt(RUN_2);

      expect(provider.counters.byKind).toEqual({
        probe: 1,
        collect: 0,
        repository: 0,
      });
      await expect(contributionCount()).resolves.toBe(before);
      expect(
        new Set(
          [...(await lastSuccessAts()).values()].map((d) => d?.getTime()),
        ),
      ).toEqual(new Set([RUN_2.getTime() - SKEW_MS]));
      expect(summary).toMatchObject({
        probeRequests: 1,
        collectedRepos: 0,
        requests: 1,
        inserted: 0,
      });
    },
  );

  itWithFixture(
    '새 활동이 생긴 저장소 3개만 다시 수집하고 새 기여 3건만 넣는다',
    async ({ provider, runAt, contributionCount }) => {
      await runAt(RUN_2);
      const before = await contributionCount();
      const changed = [3, 42, 99];
      for (const index of changed) {
        provider.mutate(ORG_LOGIN, `repo-${index}`, (repo) => {
          repo.commits.push({
            sha: `synthetic-${index}-commit-new`,
            authorId: contributorId(index),
            committedAt: new Date(RUN_2.getTime() + 10 * 60_000).toISOString(),
          });
        });
      }

      await runAt(RUN_3);

      expect(provider.counters.byKind).toEqual({
        probe: 1,
        collect: changed.length,
        repository: 0,
      });
      expect([...provider.counters.byRepository.keys()].sort()).toEqual(
        changed.map((index) => `${ORG_LOGIN}/repo-${index}`).sort(),
      );
      await expect(contributionCount()).resolves.toBe(before + changed.length);
    },
  );

  itWithFixture(
    '주간 전체 재수집은 활동과 무관하게 모두 다시 읽고 중복 없이 0건을 넣는다',
    async ({ provider, runAt, contributionCount }) => {
      await runAt(RUN_3);
      const before = await contributionCount();

      const summary = await runAt(RUN_4, 'weekly');

      expect(provider.counters.byKind).toEqual({
        probe: 1,
        collect: REPO_COUNT + 1,
        repository: 0,
      });
      await expect(contributionCount()).resolves.toBe(before);
      expect(summary).toMatchObject({
        kind: 'weekly',
        collectedRepos: REPO_COUNT,
        inserted: 0,
        fullScanFailedRepos: 0,
        truncatedRepos: 0,
      });
    },
  );

  itWithFixture(
    '이름이 바뀐 저장소는 id로 다시 찾아 수집하고, 사라진 저장소는 gone 처리하고 나머지는 그대로 진행한다',
    async ({ prisma, provider, runAt, lastSuccessAts }) => {
      await runAt(RUN_4);
      provider.mutate(ORG_LOGIN, 'repo-10', (repo) => {
        repo.name = 'repo-10-renamed';
        repo.commits.push({
          sha: 'synthetic-10-commit-after-rename',
          authorId: contributorId(10),
          committedAt: new Date(RUN_4.getTime() + 10 * 60_000).toISOString(),
        });
      });
      provider.remove(ORG_LOGIN, 'repo-11');
      const runAfter = new Date(RUN_4.getTime() + HOUR);

      const summary = await runAt(runAfter);

      expect(provider.counters.byKind).toEqual({
        probe: 1,
        collect: 1,
        repository: 2,
      });
      await expect(
        prisma.repo.findUniqueOrThrow({
          where: { githubRepoId: BigInt(FIRST_REPO_ID + 10) },
          select: { ownerName: true },
        }),
      ).resolves.toEqual({ ownerName: `${ORG_LOGIN}/repo-10-renamed` });
      const gone = await prisma.repo.findUniqueOrThrow({
        where: { githubRepoId: BigInt(FIRST_REPO_ID + 11) },
        select: { goneAt: true, lastSuccessAt: true, ownerName: true },
      });
      expect(gone.goneAt).not.toBeNull();
      expect(gone.lastSuccessAt).toEqual(new Date(RUN_4.getTime() - SKEW_MS));
      const successes = await lastSuccessAts();
      expect(successes.get(BigInt(FIRST_REPO_ID + 10))).toEqual(
        new Date(runAfter.getTime() - SKEW_MS),
      );
      expect(successes.get(BigInt(FIRST_REPO_ID + 12))).toEqual(
        new Date(runAfter.getTime() - SKEW_MS),
      );
      expect(summary).toMatchObject({ collectedRepos: 1 });

      await runAt(new Date(runAfter.getTime() + HOUR));
      expect(provider.counters.byKind).toEqual({
        probe: 1,
        collect: 0,
        repository: 0,
      });
    },
  );

  itWithFixture(
    '빼앗긴 lease로 연 트랜잭션은 기여를 한 줄도 남기지 않는다',
    async ({ prisma, repository, contributionCount }) => {
      await prisma.collectionSyncLease.deleteMany({
        where: { appId: APP_ID, scope: SCOPE },
      });
      const leaseAt = new Date('2026-01-01T00:00:00.000Z');
      const stale = await repository.acquireSyncLease({
        appId: APP_ID,
        scope: SCOPE,
        ownerId: 'stale-owner',
        runId: 'stale-run',
        now: leaseAt,
        expiresAt: new Date(leaseAt.getTime() + 1_000),
      });
      if (!stale) throw new Error('expected to acquire the initial lease');
      const takeoverAt = new Date(leaseAt.getTime() + 2_000);
      const winner = await repository.acquireSyncLease({
        appId: APP_ID,
        scope: SCOPE,
        ownerId: 'winning-owner',
        runId: 'winning-run',
        now: takeoverAt,
        expiresAt: new Date(takeoverAt.getTime() + 60_000),
      });
      expect(winner?.epoch).toBe(stale.epoch + 1n);
      const row = await repository.findCollectionTargetByLogicalKey(
        BigInt(FIRST_REPO_ID + 20),
      );
      if (!row) throw new Error('fixture repository missing');
      const before = await contributionCount();

      await expect(
        repository.runInTransaction(async (repo) => {
          await repo.assertSyncLeaseValid(stale, takeoverAt);
          await repo.recordContributions(row.githubRepositoryId, 'commit', [
            {
              githubKey: 'synthetic-stale-lease-write-attempt',
              authorGithubId: null,
              occurredAt: takeoverAt,
            },
          ]);
        }),
      ).rejects.toThrow('lease is stale');

      await expect(contributionCount()).resolves.toBe(before);
      if (winner) {
        await repository.releaseSyncLease(
          winner,
          new Date(takeoverAt.getTime() + 1),
        );
      }
    },
  );
});

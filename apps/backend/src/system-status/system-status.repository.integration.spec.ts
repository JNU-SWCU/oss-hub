import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import {
  prisma,
  service,
  githubId,
  programId,
  oldId,
  input,
} from '../applications/student-repository-url.integration.fixture';
import { SystemStatusRepository } from './system-status.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

// 통합 DB는 스펙끼리 공유하므로 절댓값이 아니라 연결을 바꾼 전후 차이를 본다.
const status = new SystemStatusRepository(prisma);

it('drops a detached organization repository from the tracked set so its missing streams stop reading as partial', async () => {
  // Given: A is the linked organization repository and has no stream rows yet.
  const before = await status.getIncrementalStatusSnapshot();
  // When: the team links external B instead, detaching A with its team history.
  await service.updateMine(githubId, programId, input);
  // Then
  const after = await status.getIncrementalStatusSnapshot();
  expect(after.trackedRepositoryCount).toBe(before.trackedRepositoryCount - 1);
  // 저장소마다 Commit·PR·Release·Issue 네 stream이 빠진다.
  expect(after.partialStreamCount).toBe(before.partialStreamCount - 4);
});

it('counts the new external link instead of the detached external one', async () => {
  // Given: A is the linked external repository; B is not yet present.
  await prisma.githubRepository.update({
    where: { id: oldId },
    data: { source: 'EXTERNAL_PUBLIC' },
  });
  const before = await status.getExternalCollectionStatus();
  // When: B replaces A — B becomes present and linked, A keeps only its history.
  await service.updateMine(githubId, programId, input);
  // Then: B joins and A leaves, so the tracked count is unchanged.
  const after = await status.getExternalCollectionStatus();
  expect(after.trackedRepositoryCount).toBe(before.trackedRepositoryCount);
});

it('adds link-time collections and issues to the external totals while the last run stays a full sweep', async () => {
  // Given: an external sweep, then a link-time collection of one repository (#1133) — both later
  // than any row other specs left (some run their clock in 2099), so they are the newest.
  const before = await status.getExternalCollectionStatus();
  const newest = await prisma.collectionSweepHistory.aggregate({
    _max: { sweepFinishedAt: true },
  });
  const sweepAt = new Date(
    Math.max(newest._max.sweepFinishedAt?.getTime() ?? 0, Date.now()) + 60_000,
  );
  const base = {
    appId: 1n,
    scope: 'external',
    cycleStartedAt: null,
    failedRepositoryCount: 0,
    stoppedForBudget: false,
  };
  const sweep = await prisma.collectionSweepHistory.create({
    data: {
      ...base,
      kind: 'SWEEP',
      sweepFinishedAt: sweepAt,
      insertedCommitCount: 1,
      insertedPullRequestCount: 0,
      insertedReleaseCount: 0,
      insertedIssueCount: 2,
      attemptedRepositoryCount: 3,
      processedRepositoryCount: 3,
      cycleCompleted: true,
    },
  });
  const link = await prisma.collectionSweepHistory.create({
    data: {
      ...base,
      kind: 'REPOSITORY_LINK',
      sweepFinishedAt: new Date(sweepAt.getTime() + 30 * 60_000),
      insertedCommitCount: 141,
      insertedPullRequestCount: 13,
      insertedReleaseCount: 0,
      insertedIssueCount: 0,
      attemptedRepositoryCount: 1,
      processedRepositoryCount: 1,
      cycleCompleted: false,
    },
  });
  try {
    // When
    const after = await status.getExternalCollectionStatus();
    const recent = await status.getRecentSweepActivity(2);
    // Then: both kinds add up, issues included — the next sweep never recounts what a link-time
    // collection stored.
    expect(after.cumulativeCommitCount - before.cumulativeCommitCount).toBe(
      142,
    );
    expect(
      after.cumulativePullRequestCount - before.cumulativePullRequestCount,
    ).toBe(13);
    expect(after.cumulativeIssueCount - before.cumulativeIssueCount).toBe(2);
    // 「최근 외부 수집 실행」 speaks for the sweep: the newer one-repository run is not it.
    expect(after.lastSweep).toMatchObject({
      kind: 'SWEEP',
      attemptedRepositoryCount: 3,
    });
    expect(recent.map((row) => row.kind)).toEqual(['REPOSITORY_LINK', 'SWEEP']);
  } finally {
    await prisma.collectionSweepHistory.deleteMany({
      where: { id: { in: [sweep.id, link.id] } },
    });
  }
});

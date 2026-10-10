import { assertIsolatedIntegrationDatabase } from '../../../test/integration-database.guard';
import {
  prisma,
  service,
  githubId,
  programId,
  oldId,
  input,
} from '../../applications/service/student-repository-url.integration.fixture';
import { SystemStatusRepository } from './system-status.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const status = new SystemStatusRepository(prisma);

it('drops a detached organization repository from the tracked set so its missing streams stop reading as partial', async () => {
  const before = await status.getIncrementalStatusSnapshot();

  await service.updateMine(githubId, programId, input);

  const after = await status.getIncrementalStatusSnapshot();
  expect(after.trackedRepositoryCount).toBe(before.trackedRepositoryCount - 1);

  expect(after.partialStreamCount).toBe(before.partialStreamCount - 4);
});

it('counts the new external link instead of the detached external one', async () => {
  await prisma.githubRepository.update({
    where: { id: oldId },
    data: { source: 'EXTERNAL_PUBLIC' },
  });
  const before = await status.getExternalCollectionStatus();

  await service.updateMine(githubId, programId, input);

  const after = await status.getExternalCollectionStatus();
  expect(after.trackedRepositoryCount).toBe(before.trackedRepositoryCount);
});

it('drops an external repository from the tracked count once deletion clears its links', async () => {
  await prisma.githubRepository.update({
    where: { id: oldId },
    data: {
      source: 'EXTERNAL_PUBLIC',
      presence: 'PRESENT',
      visibility: 'PUBLIC',
    },
  });
  const linked = await status.getExternalCollectionStatus();

  await prisma.githubRepository.update({
    where: { id: oldId },
    data: { applicationId: null, programId: null, teamId: null },
  });

  const cleared = await status.getExternalCollectionStatus();
  expect(cleared.trackedRepositoryCount).toBe(
    linked.trackedRepositoryCount - 1,
  );
});

it('adds link-time collections and issues to the external totals while the last run stays a full sweep', async () => {
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
    const after = await status.getExternalCollectionStatus();
    const recent = await status.getRecentSweepActivity(2);

    expect(after.cumulativeCommitCount - before.cumulativeCommitCount).toBe(
      142,
    );
    expect(
      after.cumulativePullRequestCount - before.cumulativePullRequestCount,
    ).toBe(13);
    expect(after.cumulativeIssueCount - before.cumulativeIssueCount).toBe(2);

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

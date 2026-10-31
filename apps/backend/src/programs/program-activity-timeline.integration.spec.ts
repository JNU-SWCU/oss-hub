import { ProgramViewerService } from './program-viewer.service';
import { ProgramListStatusFilterRepository } from './program-list-status-filter.repository';
import { PlatformRepository } from '../platform/platform.repository';
import { randomUUID } from 'node:crypto';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../platform/prisma.service';
import { ProgramActivityRepository } from './program-activity.repository';
import { ProgramsRepository } from './programs.repository';
import { ProgramActivityService } from './program-activity.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const prefix = `activity-timeline-${randomUUID()}`;
const githubId = BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 12)}`);
const studentId = `${prefix}-student`;
const programId = `${prefix}-program`;
const teamId = `${prefix}-team`;
const applicationId = `${prefix}-application`;
const linkedRepositoryId = `${prefix}-linked`;
const unlinkedRepositoryId = `${prefix}-unlinked`;

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});

it('counts only current linked activity and never substitutes detached or unrelated repository facts', async () => {
  await prisma.user.create({
    data: { id: studentId, githubId, nickname: 'synthetic-student' },
  });
  await prisma.program.create({
    data: {
      id: programId,
      name: 'Synthetic program',
      organizer: 'Synthetic',
      category: 'BASIC',
      applicationTemplateKey: 'synthetic',
      applicationTemplateVersion: 1,
      description: 'Synthetic',
      applicationStartAt: new Date('2026-07-01Z'),
      applicationEndAt: new Date('2026-07-31Z'),
    },
  });
  await prisma.team.create({
    data: {
      id: teamId,
      programId,
      name: 'Synthetic team',
      joinCodeDigest: prefix,
      leaderId: studentId,
    },
  });
  await prisma.teamMember.create({
    data: { teamId, programId, userId: studentId },
  });
  await prisma.application.create({
    data: {
      id: applicationId,
      programId,
      teamId,
      applicantId: studentId,
      status: 'APPROVED',
      answers: {},
      applicationTemplateVersion: 1,
    },
  });
  await prisma.githubRepository.createMany({
    data: [
      {
        id: linkedRepositoryId,
        githubRepositoryId: githubId + 1n,
        nameWithOwner: 'synthetic/linked',
        source: 'EXTERNAL_PUBLIC',
        applicationId,
        programId,
        teamId,
      },
      {
        id: unlinkedRepositoryId,
        githubRepositoryId: githubId + 2n,
        nameWithOwner: 'synthetic/unlinked',
        source: 'ORG_PROVISIONED',
        programId,
        teamId,
      },
    ],
  });
  await prisma.githubIssueHistory.createMany({
    data: [
      {
        repositoryId: linkedRepositoryId,
        githubIssueId: 1n,
        createdAt: new Date('2026-07-31T14:59:59Z'),
        authorGithubId: githubId,
      },
      {
        repositoryId: linkedRepositoryId,
        githubIssueId: 2n,
        createdAt: new Date('2026-07-31T15:00:00Z'),
        authorGithubId: githubId,
      },
      {
        repositoryId: linkedRepositoryId,
        githubIssueId: 3n,
        createdAt: new Date('2026-08-02T00:00:00Z'),
        authorGithubId: githubId + 99n,
      },
      {
        repositoryId: unlinkedRepositoryId,
        githubIssueId: 4n,
        createdAt: new Date('2026-08-02T00:00:00Z'),
        authorGithubId: githubId,
      },
    ].map((issue) => ({ ...issue, state: 'open' })),
  });
  await prisma.collectionCommitFact.create({
    data: {
      repositoryId: linkedRepositoryId,
      sha: `${prefix}-commit`,
      committedAt: new Date('2026-08-03T00:00:00Z'),
      authorGithubId: githubId,
    },
  });

  const service = new ProgramActivityService(
    new ProgramsRepository(
      prisma,
      new PlatformRepository(),
      new ProgramListStatusFilterRepository(),
    ),
    new ProgramActivityRepository(prisma, new PlatformRepository()),
    Object.create(ProgramViewerService.prototype) as ProgramViewerService,
  );
  const timeline = await service.activityTimeline(
    { githubId, userId: studentId },
    'MONTH',
  );

  expect(timeline.series.points).toEqual([
    {
      period: '2026-07',
      commitCount: 0,
      pullRequestCount: 0,
      releaseCount: 0,
      issueCount: 1,
      total: 0,
    },
    {
      period: '2026-08',
      commitCount: 1,
      pullRequestCount: 0,
      releaseCount: 0,
      issueCount: 1,
      total: 1,
    },
  ]);
  expect(
    await prisma.githubIssueHistory.count({
      where: { repositoryId: unlinkedRepositoryId },
    }),
  ).toBe(1);
  await prisma.githubRepository.update({
    where: { id: linkedRepositoryId },
    data: { applicationId: null },
  });
  const detached = await service.activityTimeline(
    { githubId, userId: studentId },
    'MONTH',
  );
  expect(detached.series.points).toEqual([]);
  expect(detached.dataAsOf).toBeNull();
  expect(
    await prisma.collectionCommitFact.count({
      where: { repositoryId: linkedRepositoryId },
    }),
  ).toBe(1);
  await expect(
    prisma.githubRepository.findUniqueOrThrow({
      where: { id: linkedRepositoryId },
    }),
  ).resolves.toMatchObject({ programId, teamId });

  await prisma.githubRepository.update({
    where: { id: linkedRepositoryId },
    data: { applicationId },
  });
  await prisma.collectionCommitFact.deleteMany({
    where: { repositoryId: linkedRepositoryId },
  });
  await prisma.githubIssueHistory.deleteMany({
    where: { repositoryId: linkedRepositoryId },
  });
  const empty = await service.activityTimeline(
    { githubId, userId: studentId },
    'MONTH',
  );
  expect(empty.series.points).toEqual([]);
  expect(
    await prisma.githubIssueHistory.count({
      where: { repositoryId: unlinkedRepositoryId },
    }),
  ).toBe(1);
});

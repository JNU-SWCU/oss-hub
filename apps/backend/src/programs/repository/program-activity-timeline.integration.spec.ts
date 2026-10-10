import { randomUUID } from 'node:crypto';
import { assertIsolatedIntegrationDatabase } from '../../../test/integration-database.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { ProgramActivityRepository } from './program-activity.repository';
import { ProgramsRepository } from './programs.repository';
import { ProgramActivityService } from '../service/program-activity.service';

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

it('counts only issues the student opened in the repository linked to the student application', async () => {
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

  const timeline = await new ProgramActivityService(
    new ProgramsRepository(prisma),
    new ProgramActivityRepository(prisma),
  ).activityTimeline({ githubId, userId: studentId, role: 'STUDENT' }, 'MONTH');

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
});

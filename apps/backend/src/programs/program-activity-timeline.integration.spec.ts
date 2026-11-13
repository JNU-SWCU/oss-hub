import { ProgramViewerService } from './program-viewer.service';
import {
  ProgramListStatusFilterRepository,
  ProgramsRepository,
} from './programs.repository';
import { PlatformRepository } from '../platform/platform.repository';
import { randomUUID } from 'node:crypto';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../platform/prisma.service';
import { ProgramActivityRepository } from './program-activity.repository';
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
      startAt: new Date('2026-07-01Z'),
      endAt: new Date(new Date('2026-07-31Z').getTime() + 365 * 86400000),
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
      leaderId: studentId,
      applicantId: studentId,
      answers: { title: 'Synthetic team' },
      applicationTemplateVersion: 1,
    },
  });
  await prisma.teamMember.create({
    data: { teamId, programId, userId: studentId },
  });
  await prisma.team.update({
    where: { id: teamId },
    data: {
      programId,
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
        teamId,
      },
      {
        id: unlinkedRepositoryId,
        githubRepositoryId: githubId + 2n,
        nameWithOwner: 'synthetic/unlinked',
        source: 'ORG_PROVISIONED',
        teamId: null,
      },
    ],
  });
  await prisma.repo.create({
    data: {
      githubRepoId: githubId + 1n,
      ownerName: 'synthetic',
      source: 'EXTERNAL_PUBLIC',
    },
  });
  const seenAt = new Date('2026-08-03T00:00:00Z');
  await prisma.contributionEvent.createMany({
    data: [
      {
        repoId: githubId + 1n,
        kind: 'ISSUE',
        githubKey: '1',
        authorGithubId: githubId,
        occurredAt: new Date('2026-07-31T14:59:59Z'),
        firstSeenAt: seenAt,
      },
      {
        repoId: githubId + 1n,
        kind: 'ISSUE',
        githubKey: '2',
        authorGithubId: githubId,
        occurredAt: new Date('2026-07-31T15:00:00Z'),
        firstSeenAt: seenAt,
      },
      {
        repoId: githubId + 1n,
        kind: 'ISSUE',
        githubKey: '3',
        authorGithubId: githubId + 99n,
        occurredAt: new Date('2026-08-02T00:00:00Z'),
        firstSeenAt: seenAt,
      },
      {
        repoId: githubId + 1n,
        kind: 'COMMIT',
        githubKey: `${prefix}-commit`,
        authorGithubId: githubId,
        occurredAt: new Date('2026-08-03T00:00:00Z'),
        firstSeenAt: seenAt,
      },
    ],
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
  await prisma.githubRepository.update({
    where: { id: linkedRepositoryId },
    data: { teamId: null },
  });
  const detached = await service.activityTimeline(
    { githubId, userId: studentId },
    'MONTH',
  );
  expect(detached.series.points).toEqual([]);
  expect(detached.dataAsOf).toBeNull();
  expect(
    await prisma.contributionEvent.count({
      where: { repoId: githubId + 1n, kind: 'COMMIT' },
    }),
  ).toBe(1);
  await expect(
    prisma.githubRepository.findUniqueOrThrow({
      where: { id: linkedRepositoryId },
    }),
  ).resolves.toMatchObject({ teamId: null });

  await prisma.githubRepository.update({
    where: { id: linkedRepositoryId },
    data: { teamId },
  });
  await prisma.contributionEvent.deleteMany({
    where: { repoId: githubId + 1n },
  });
  const empty = await service.activityTimeline(
    { githubId, userId: studentId },
    'MONTH',
  );
  expect(empty.series.points).toEqual([]);
});

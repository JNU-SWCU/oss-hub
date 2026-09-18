import { randomUUID } from 'node:crypto';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ProgramTeamsRepository } from './repository/program-teams.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const prefix = `staff-evidence-${randomUUID()}`;
const githubId = BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 12)}`);
const memberId = `${prefix}-member`;
const programId = `${prefix}-program`;
const teamId = `${prefix}-team`;
const applicationId = `${prefix}-application`;
const oldRepositoryId = `${prefix}-old`;
const repositoryId = `${prefix}-current`;

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  // The isolated runner removes the database without violating append-only audit history.
  await prisma.$disconnect();
});

it('projects only linked repository facts inside the program window while retaining old repository history', async () => {
  // Given
  await prisma.user.create({
    data: { id: memberId, githubId, nickname: 'synthetic-member' },
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
      startAt: new Date('2026-07-31T15:00:00Z'),
      endAt: new Date('2026-08-31T14:59:59Z'),
    },
  });
  await prisma.team.create({
    data: {
      id: teamId,
      programId,
      name: 'Synthetic team',
      joinCodeDigest: prefix,
      leaderId: memberId,
    },
  });
  await prisma.teamMember.create({
    data: { teamId, programId, userId: memberId },
  });
  await prisma.application.create({
    data: {
      id: applicationId,
      programId,
      teamId,
      applicantId: memberId,
      answers: {},
      applicationTemplateVersion: 1,
    },
  });
  await prisma.githubRepository.createMany({
    data: [
      {
        id: oldRepositoryId,
        githubRepositoryId: githubId + 1n,
        nameWithOwner: 'synthetic/old',
        source: 'ORG_PROVISIONED',
        programId,
        teamId,
      },
      {
        id: repositoryId,
        githubRepositoryId: githubId + 2n,
        nameWithOwner: 'synthetic/current',
        source: 'EXTERNAL_PUBLIC',
        applicationId,
        programId,
        teamId,
        lastSuccessAt: new Date('2026-09-01Z'),
      },
    ],
  });
  await prisma.contribution.createMany({
    data: [
      {
        repositoryId: oldRepositoryId,
        githubId,
        date: new Date('2026-08-01Z'),
        commitCount: 900,
      },
      {
        repositoryId,
        githubId,
        date: new Date('2026-07-31Z'),
        commitCount: 800,
      },
      { repositoryId, githubId, date: new Date('2026-08-01Z'), commitCount: 3 },
      { repositoryId, githubId, date: new Date('2026-08-31Z'), commitCount: 4 },
      {
        repositoryId,
        githubId,
        date: new Date('2026-09-01Z'),
        commitCount: 700,
      },
      {
        repositoryId,
        githubId: githubId + 99n,
        date: new Date('2026-08-01Z'),
        commitCount: 5,
      },
    ],
  });
  const metadata = {
    schemaVersion: 1,
    programId,
    teamId,
    programName: 'Synthetic program',
    actorGithubLogin: 'actor-before-rename',
    reason: 'Correct repository',
    before: {
      repositoryId: oldRepositoryId,
      repositoryUrl: 'https://github.com/synthetic/old',
    },
    after: {
      repositoryId,
      repositoryUrl: 'https://github.com/synthetic/current',
    },
  };
  await prisma.auditLog.createMany({
    data: [
      {
        actorId: memberId,
        action: 'APPLICATION_REPOSITORY_URL_CHANGED',
        targetType: 'APPLICATION',
        targetId: applicationId,
        metadata,
      },
      {
        actorId: memberId,
        action: 'APPLICATION_REPOSITORY_URL_CHANGED',
        targetType: 'APPLICATION',
        targetId: applicationId,
        metadata: { ...metadata, teamId: 'unrelated-team' },
      },
    ],
  });
  // When
  const detail = await new ProgramTeamsRepository(prisma).findStaffTeamDetail(
    programId,
    teamId,
  );
  // Then
  expect(detail?.repositoryContributions?.members).toEqual([
    {
      userId: memberId,
      githubId: githubId.toString(),
      commitCount: 7,
      pullRequestCount: 0,
      releaseCount: 0,
      hasObservations: true,
    },
  ]);
  expect(detail?.repositoryContributions?.unmatchedContributors).toEqual([
    {
      githubId: (githubId + 99n).toString(),
      commitCount: 5,
      pullRequestCount: 0,
      releaseCount: 0,
    },
  ]);
  expect(detail?.repositoryUrlHistory.items).toHaveLength(1);
  expect(detail?.repositoryUrlHistory.items[0]?.actorGithubLogin).toBe(
    'actor-before-rename',
  );
  expect(
    await prisma.contribution.count({
      where: { repositoryId: oldRepositoryId },
    }),
  ).toBe(1);
});

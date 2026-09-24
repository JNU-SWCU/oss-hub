import { randomUUID } from 'node:crypto';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ProgramActivityRepository } from './repository/program-activity.repository';
import { ProgramActivitySummaryRepository } from './repository/program-activity-summary.repository';
import { ProgramTeamsRepository } from './repository/program-teams.repository';
import { ProgramActivitySummaryService } from './service/program-activity-summary.service';

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

it('reads contributions of a program that never set an end date', async () => {
  // Given — endAt omitted keeps the 9999-12-31T23:59:59.999 sentinel, which Seoul reads as year 10000.
  // The legacy write trigger moves an omitted startAt to applicationEndAt.
  const scope = `staff-evidence-sentinel-${randomUUID()}`;
  const base = BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 12)}`);
  const scopedProgramId = `${scope}-program`;
  const scopedTeamId = `${scope}-team`;
  const scopedApplicationId = `${scope}-application`;
  const scopedRepositoryId = `${scope}-repository`;
  await prisma.user.create({
    data: { id: `${scope}-member`, githubId: base, nickname: 'sentinel' },
  });
  await prisma.program.create({
    data: {
      id: scopedProgramId,
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
      id: scopedTeamId,
      programId: scopedProgramId,
      name: 'Synthetic team',
      joinCodeDigest: scope,
      leaderId: `${scope}-member`,
    },
  });
  await prisma.teamMember.create({
    data: {
      teamId: scopedTeamId,
      programId: scopedProgramId,
      userId: `${scope}-member`,
    },
  });
  await prisma.application.create({
    data: {
      id: scopedApplicationId,
      programId: scopedProgramId,
      teamId: scopedTeamId,
      applicantId: `${scope}-member`,
      answers: {},
      applicationTemplateVersion: 1,
    },
  });
  await prisma.githubRepository.create({
    data: {
      id: scopedRepositoryId,
      githubRepositoryId: base + 1n,
      nameWithOwner: 'synthetic/sentinel',
      source: 'EXTERNAL_PUBLIC',
      applicationId: scopedApplicationId,
      programId: scopedProgramId,
      teamId: scopedTeamId,
      lastSuccessAt: new Date('2026-09-01Z'),
    },
  });
  await prisma.contribution.create({
    data: {
      repositoryId: scopedRepositoryId,
      githubId: base,
      date: new Date('2026-08-01Z'),
      commitCount: 3,
    },
  });
  // When
  const detail = await new ProgramTeamsRepository(prisma).findStaffTeamDetail(
    scopedProgramId,
    scopedTeamId,
  );
  // Then
  expect(detail?.repositoryContributions).toMatchObject({
    window: { from: '2026-07-31', to: '+010000-01-01', timeZone: 'Asia/Seoul' },
    members: [{ userId: `${scope}-member`, commitCount: 3 }],
  });
});

it('counts only the currently linked repository in program totals after a relink', async () => {
  // Given — the first test left a relinked team: the old organization repository kept
  // programId after losing applicationId, and the current repository is linked.
  await prisma.collectionCommitFact.createMany({
    data: [
      { repositoryId: oldRepositoryId, sha: `${prefix}-old-1` },
      { repositoryId, sha: `${prefix}-current-1` },
      { repositoryId, sha: `${prefix}-current-2` },
    ].map((fact) => ({
      ...fact,
      committedAt: new Date('2026-08-05T00:00:00Z'),
      authorGithubId: githubId,
    })),
  });
  // When
  const [summary] = await new ProgramActivitySummaryService(
    new ProgramActivitySummaryRepository(prisma),
    new ProgramActivityRepository(prisma),
  ).summarize([programId]);
  // Then
  expect(summary).toMatchObject({
    programId,
    repositoryCount: 1,
    commitCount: 2,
  });
});

it('does not show a person who only opened issues in the window as zero commits, PRs and releases', async () => {
  // Given — #1133: a day with only issues leaves a Contribution row whose three shown counts are 0.
  const scope = `staff-evidence-issue-${randomUUID()}`;
  const base = BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 12)}`);
  const activeId = `${scope}-active`;
  const issueOnlyId = `${scope}-issue-only`;
  const scopedProgramId = `${scope}-program`;
  const scopedTeamId = `${scope}-team`;
  const scopedApplicationId = `${scope}-application`;
  const scopedRepositoryId = `${scope}-repository`;
  await prisma.user.createMany({
    data: [
      { id: activeId, githubId: base, nickname: 'synthetic-active' },
      { id: issueOnlyId, githubId: base + 1n, nickname: 'synthetic-issuer' },
    ],
  });
  await prisma.program.create({
    data: {
      id: scopedProgramId,
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
      id: scopedTeamId,
      programId: scopedProgramId,
      name: 'Synthetic team',
      joinCodeDigest: scope,
      leaderId: activeId,
    },
  });
  await prisma.teamMember.createMany({
    data: [activeId, issueOnlyId].map((userId) => ({
      teamId: scopedTeamId,
      programId: scopedProgramId,
      userId,
    })),
  });
  await prisma.application.create({
    data: {
      id: scopedApplicationId,
      programId: scopedProgramId,
      teamId: scopedTeamId,
      applicantId: activeId,
      answers: {},
      applicationTemplateVersion: 1,
    },
  });
  await prisma.githubRepository.create({
    data: {
      id: scopedRepositoryId,
      githubRepositoryId: base + 2n,
      nameWithOwner: 'synthetic/issue-only',
      source: 'EXTERNAL_PUBLIC',
      applicationId: scopedApplicationId,
      programId: scopedProgramId,
      teamId: scopedTeamId,
      lastSuccessAt: new Date('2026-09-01Z'),
    },
  });
  await prisma.contribution.createMany({
    data: [
      { githubId: base, date: new Date('2026-08-01Z'), commitCount: 2 },
      // An issue-only day of someone with commits keeps their sums unchanged.
      { githubId: base, date: new Date('2026-08-02Z'), issueCount: 5 },
      { githubId: base + 1n, date: new Date('2026-08-01Z'), issueCount: 1 },
      // Outside the team: the issue-only person drops out, the PR author stays.
      { githubId: base + 3n, date: new Date('2026-08-03Z'), issueCount: 4 },
      {
        githubId: base + 4n,
        date: new Date('2026-08-03Z'),
        pullRequestCount: 1,
      },
    ].map((row) => ({ ...row, repositoryId: scopedRepositoryId })),
  });
  // When
  const detail = await new ProgramTeamsRepository(prisma).findStaffTeamDetail(
    scopedProgramId,
    scopedTeamId,
  );
  // Then
  expect(
    [...(detail?.repositoryContributions?.members ?? [])].sort((a, b) =>
      a.userId.localeCompare(b.userId),
    ),
  ).toEqual([
    {
      userId: activeId,
      githubId: base.toString(),
      commitCount: 2,
      pullRequestCount: 0,
      releaseCount: 0,
      hasObservations: true,
    },
    {
      userId: issueOnlyId,
      githubId: (base + 1n).toString(),
      commitCount: 0,
      pullRequestCount: 0,
      releaseCount: 0,
      hasObservations: false,
    },
  ]);
  expect(detail?.repositoryContributions?.unmatchedContributors).toEqual([
    {
      githubId: (base + 4n).toString(),
      commitCount: 0,
      pullRequestCount: 1,
      releaseCount: 0,
    },
  ]);
});

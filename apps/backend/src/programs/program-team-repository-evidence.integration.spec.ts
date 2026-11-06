import { TeamHistoryRepository } from './team-history.repository';
import { StudentRepositoryUrlService } from './team-application.service';
import { PlatformRepository } from '../platform/platform.repository';
import { PrismaSerializationRetryRepository } from '../platform/prisma-serialization-retry.repository';
import {
  TeamDeletionScopeRepository,
  TeamRepository,
  ProgramTeamDeletionRepository,
} from './team.repository';
import { ProgramTeamRepositoryEvidenceRepository } from './program-team-repository-evidence.repository';
import { randomUUID } from 'node:crypto';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../platform/prisma.service';
import {
  ProgramActivityRepository,
  ProgramActivitySummaryRepository,
} from './program-activity.repository';
import { ProgramActivitySummaryService } from './program-activity-summary.service';
import { TeamMembershipService } from './team-membership.service';
import { HistoryMetadataService } from '../platform/history-metadata.service';
import { RepositoryPublishService } from '../github/repository-publish.service';
import { RepositoryUrlService } from '../github/repository-url.service';
import { MilestoneCompletionService } from './submissions.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const teamsService = new TeamMembershipService(
  new TeamRepository(
    prisma,
    new ProgramTeamRepositoryEvidenceRepository(prisma),
    new PlatformRepository(),
    new TeamHistoryRepository(),
  ),
  new ProgramTeamDeletionRepository(
    new TeamHistoryRepository(),
    prisma,
    new TeamDeletionScopeRepository(),
    new PrismaSerializationRetryRepository(),
  ),
  new HistoryMetadataService(),
  new RepositoryPublishService(),
  new RepositoryUrlService(),
  new MilestoneCompletionService(),
  new StudentRepositoryUrlService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  ),
);
const prefix = `staff-evidence-${randomUUID()}`;
const githubId = BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 12)}`);
const memberId = `${prefix}-member`;
const programId = `${prefix}-program`;
const teamId = `${prefix}-team`;
const oldRepositoryId = `${prefix}-old`;
const repositoryId = `${prefix}-current`;

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});

it('projects current repository facts and URL audit history without reading or mutating unrelated repository facts', async () => {
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
      leaderId: memberId,
      applicantId: memberId,
      answers: { title: 'Synthetic team' },
      applicationTemplateVersion: 1,
    },
  });
  await prisma.teamMember.create({
    data: { teamId, programId, userId: memberId },
  });
  await prisma.team.update({
    where: { id: teamId },
    data: {
      programId,
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
        teamId: null,
      },
      {
        id: repositoryId,
        githubRepositoryId: githubId + 2n,
        nameWithOwner: 'synthetic/current',
        source: 'EXTERNAL_PUBLIC',
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
  await prisma.teamHistory.createMany({
    data: [
      {
        teamId,
        programId,
        actorId: memberId,
        event: 'REPOSITORY_URL_CHANGED',
        source: 'APPLICATION',
        data: { schemaVersion: 1, metadata },
      },
      {
        teamId: `${prefix}-unrelated-team`,
        programId,
        actorId: memberId,
        event: 'REPOSITORY_URL_CHANGED',
        source: 'APPLICATION',
        data: {
          schemaVersion: 1,
          metadata: { ...metadata, teamId: `${prefix}-unrelated-team` },
        },
      },
    ],
  });

  const detail = await new TeamRepository(
    prisma,
    new ProgramTeamRepositoryEvidenceRepository(prisma),
    new PlatformRepository(),
    new TeamHistoryRepository(),
  ).findStaffTeamDetail(programId, teamId);

  expect(detail?.repositoryContributions?.members).toEqual([
    {
      userId: memberId,
      githubId: githubId.toString(),
      commitCount: 7,
      pullRequestCount: 0,
      releaseCount: 0,
      issueCount: 0,
      hasObservations: true,
    },
  ]);

  expect(detail?.repositoryContributions?.outsiderContributions).toBeNull();
  expect(detail?.repositoryUrlHistory.rows).toHaveLength(1);
  const view = await teamsService.getForStaff(programId, teamId);
  expect(view.repositoryUrlHistory.items).toHaveLength(1);
  expect(view.repositoryUrlHistory.items[0]?.actorGithubLogin).toBe(
    'actor-before-rename',
  );
  expect(
    await prisma.contribution.count({
      where: { repositoryId: oldRepositoryId },
    }),
  ).toBe(1);
});

it('shows the outsider totals only while they were counted for this program window', async () => {
  const scope = `staff-evidence-outsider-${randomUUID()}`;
  const memberGithubId = BigInt(
    `0x${randomUUID().replaceAll('-', '').slice(0, 12)}`,
  );
  const scoped = {
    member: `${scope}-member`,
    program: `${scope}-program`,
    team: `${scope}-team`,
    repository: `${scope}-current`,
  };
  const startAt = new Date('2026-07-31T15:00:00Z');
  const endAt = new Date('2026-08-31T14:59:59Z');
  await prisma.user.create({
    data: {
      id: scoped.member,
      githubId: memberGithubId,
      nickname: 'synthetic-outsider-member',
    },
  });
  await prisma.program.create({
    data: {
      id: scoped.program,
      name: 'Synthetic program',
      organizer: 'Synthetic',
      category: 'BASIC',
      applicationTemplateKey: 'synthetic',
      applicationTemplateVersion: 1,
      description: 'Synthetic',
      applicationStartAt: new Date('2026-07-01Z'),
      applicationEndAt: new Date('2026-07-31Z'),
      startAt,
      endAt,
    },
  });
  await prisma.team.create({
    data: {
      id: scoped.team,
      programId: scoped.program,
      name: 'Synthetic team',
      leaderId: scoped.member,
      applicantId: scoped.member,
      answers: { title: 'Synthetic team' },
      applicationTemplateVersion: 1,
    },
  });
  await prisma.teamMember.create({
    data: {
      teamId: scoped.team,
      programId: scoped.program,
      userId: scoped.member,
    },
  });
  await prisma.team.update({
    where: { id: scoped.team },
    data: {
      programId: scoped.program,
      applicantId: scoped.member,
      answers: {},
      applicationTemplateVersion: 1,
    },
  });
  await prisma.githubRepository.create({
    data: {
      id: scoped.repository,
      githubRepositoryId: memberGithubId + 1n,
      nameWithOwner: 'synthetic/outsider-current',
      source: 'EXTERNAL_PUBLIC',
      teamId: scoped.team,
      lastSuccessAt: new Date('2026-09-01Z'),
    },
  });

  await prisma.githubRepositoryOutsiderContribution.create({
    data: {
      repositoryId: scoped.repository,
      teamId: scoped.team,
      programId: scoped.program,
      windowStartAt: startAt,
      windowEndAt: endAt,
      commitCount: 3,
      pullRequestCount: 1,
      issueCount: 2,
      observedAt: new Date('2026-09-01T00:00:00Z'),
    },
  });
  const teams = new TeamRepository(
    prisma,
    new ProgramTeamRepositoryEvidenceRepository(prisma),
    new PlatformRepository(),
    new TeamHistoryRepository(),
  );
  const detail = await teams.findStaffTeamDetail(scoped.program, scoped.team);

  expect(detail?.repositoryContributions?.outsiderContributions).toEqual({
    commitCount: 3,
    pullRequestCount: 1,
    issueCount: 2,
  });

  await prisma.githubRepositoryOutsiderContribution.update({
    where: { repositoryId: scoped.repository },
    data: { teamId: `${scope}-previous-team` },
  });
  const moved = await teams.findStaffTeamDetail(scoped.program, scoped.team);
  expect(moved?.repositoryContributions?.outsiderContributions).toBeNull();
  await prisma.githubRepositoryOutsiderContribution.update({
    where: { repositoryId: scoped.repository },
    data: { teamId: scoped.team },
  });

  await prisma.program.update({
    where: { id: scoped.program },
    data: { startAt: new Date('2026-07-01T15:00:00Z') },
  });
  const edited = await teams.findStaffTeamDetail(scoped.program, scoped.team);
  expect(edited?.repositoryContributions?.outsiderContributions).toBeNull();
});

it('reads contributions of a program that never set an end date', async () => {
  const scope = `staff-evidence-sentinel-${randomUUID()}`;
  const base = BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 12)}`);
  const scopedProgramId = `${scope}-program`;
  const scopedTeamId = `${scope}-team`;
  const scopedRepositoryId = `${scope}-repository`;
  await prisma.user.create({
    data: { id: `${scope}-member`, githubId: base, nickname: 'sentinel' },
  });
  await prisma.program.create({
    data: {
      startAt: new Date('2026-07-31Z'),
      endAt: new Date('9999-12-31T23:59:59.999Z'),
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
      leaderId: `${scope}-member`,
      applicantId: `${scope}-member`,
      answers: { title: 'Synthetic team' },
      applicationTemplateVersion: 1,
    },
  });
  await prisma.teamMember.create({
    data: {
      teamId: scopedTeamId,
      programId: scopedProgramId,
      userId: `${scope}-member`,
    },
  });
  await prisma.team.update({
    where: { id: scopedTeamId },
    data: {
      programId: scopedProgramId,
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

  const detail = await new TeamRepository(
    prisma,
    new ProgramTeamRepositoryEvidenceRepository(prisma),
    new PlatformRepository(),
    new TeamHistoryRepository(),
  ).findStaffTeamDetail(scopedProgramId, scopedTeamId);

  expect(detail?.repositoryContributions).toMatchObject({
    window: { from: '2026-07-31', to: '+010000-01-01', timeZone: 'Asia/Seoul' },
    members: [{ userId: `${scope}-member`, commitCount: 3 }],
  });
});

it('counts only the currently linked repository in program totals after a relink', async () => {
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

  const [summary] = await new ProgramActivitySummaryService(
    new ProgramActivitySummaryRepository(prisma),
    new ProgramActivityRepository(prisma, new PlatformRepository()),
  ).summarize([programId]);

  expect(summary).toMatchObject({
    programId,
    repositoryCount: 1,
    commitCount: 2,
  });
});

it('counts issues for team members, so an issue-only member has observations', async () => {
  const scope = `staff-evidence-issue-${randomUUID()}`;
  const base = BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 12)}`);
  const activeId = `${scope}-active`;
  const issueOnlyId = `${scope}-issue-only`;
  const scopedProgramId = `${scope}-program`;
  const scopedTeamId = `${scope}-team`;
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
      leaderId: activeId,
      applicantId: activeId,
      answers: { title: 'Synthetic team' },
      applicationTemplateVersion: 1,
    },
  });
  await prisma.teamMember.createMany({
    data: [activeId, issueOnlyId].map((userId) => ({
      teamId: scopedTeamId,
      programId: scopedProgramId,
      userId,
    })),
  });
  await prisma.team.update({
    where: { id: scopedTeamId },
    data: {
      programId: scopedProgramId,
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
      teamId: scopedTeamId,
      lastSuccessAt: new Date('2026-09-01Z'),
    },
  });
  await prisma.contribution.createMany({
    data: [
      { githubId: base, date: new Date('2026-08-01Z'), commitCount: 2 },

      { githubId: base, date: new Date('2026-08-02Z'), issueCount: 5 },
      { githubId: base + 1n, date: new Date('2026-08-01Z'), issueCount: 1 },
    ].map((row) => ({ ...row, repositoryId: scopedRepositoryId })),
  });

  const detail = await new TeamRepository(
    prisma,
    new ProgramTeamRepositoryEvidenceRepository(prisma),
    new PlatformRepository(),
    new TeamHistoryRepository(),
  ).findStaffTeamDetail(scopedProgramId, scopedTeamId);

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
      issueCount: 5,
      hasObservations: true,
    },
    {
      userId: issueOnlyId,
      githubId: (base + 1n).toString(),
      commitCount: 0,
      pullRequestCount: 0,
      releaseCount: 0,
      issueCount: 1,
      hasObservations: true,
    },
  ]);
});

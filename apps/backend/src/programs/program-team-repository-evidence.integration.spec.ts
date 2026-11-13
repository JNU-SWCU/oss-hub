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
import {
  repositoryContributionTotals,
  seedDailyContributions,
} from '../../test/ledger-contribution.fixture';
import { PrismaService } from '../platform/prisma.service';
import {
  ProgramActivityRepository,
  ProgramActivitySummaryRepository,
} from './program-activity.repository';
import { ProgramActivitySummaryService } from './program-activity-summary.service';
import { ProgramActivityService } from './program-activity.service';
import {
  ProgramListStatusFilterRepository,
  ProgramsRepository,
} from './programs.repository';
import { ProgramViewerService } from './program-viewer.service';
import { PublicProjectMetricsRepository } from './public-project-metrics.repository';
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
    data: {
      id: memberId,
      githubId,
      nickname: 'synthetic-member',
      type: 'STUDENT',
    },
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
  await seedDailyContributions(prisma, githubId + 1n, [
    { githubId, date: '2026-08-01', commitCount: 900 },
  ]);
  await seedDailyContributions(
    prisma,
    githubId + 2n,
    [
      { githubId, date: '2026-07-31', commitCount: 800 },
      { githubId, date: '2026-08-01', commitCount: 3 },
      { githubId, date: '2026-08-31', commitCount: 4 },
      { githubId, date: '2026-09-01', commitCount: 700 },
      { githubId: githubId + 99n, date: '2026-08-01', commitCount: 5 },
    ],
    'EXTERNAL_PUBLIC',
  );
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

  expect(detail?.repositoryUrlHistory.rows).toHaveLength(1);
  const view = await teamsService.getForStaff(programId, teamId);
  expect(view.repositoryUrlHistory.items).toHaveLength(1);
  expect(view.repositoryUrlHistory.items[0]?.actorGithubLogin).toBe(
    'actor-before-rename',
  );
  expect(
    (await repositoryContributionTotals(prisma, [oldRepositoryId])).commitCount,
  ).toBe(900);
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
  await seedDailyContributions(
    prisma,
    base + 1n,
    [{ githubId: base, date: '2026-08-01', commitCount: 3 }],
    'EXTERNAL_PUBLIC',
  );

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
  const occurredAt = new Date('2026-08-05T00:00:00Z');
  await prisma.contributionEvent.deleteMany({
    where: { repoId: { in: [githubId + 1n, githubId + 2n] } },
  });
  await prisma.contributionEvent.createMany({
    data: [
      { repoId: githubId + 1n, githubKey: `${prefix}-old-1` },
      { repoId: githubId + 2n, githubKey: `${prefix}-current-1` },
      { repoId: githubId + 2n, githubKey: `${prefix}-current-2` },
    ].map((event) => ({
      ...event,
      kind: 'COMMIT' as const,
      authorGithubId: githubId,
      occurredAt,
      firstSeenAt: occurredAt,
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
  await seedDailyContributions(
    prisma,
    base + 2n,
    [
      { githubId: base, date: '2026-08-01', commitCount: 2 },
      { githubId: base, date: '2026-08-02', issueCount: 5 },
      { githubId: base + 1n, date: '2026-08-01', issueCount: 1 },
    ],
    'EXTERNAL_PUBLIC',
  );

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

it('counts only student authors in team, program and public totals', async () => {
  const scope = `student-authors-${randomUUID()}`;
  const base = BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 12)}`);
  const people = {
    member: { id: `${scope}-member`, githubId: base, type: 'STUDENT' },
    left: { id: `${scope}-left`, githubId: base + 1n, type: 'STUDENT' },
    peer: { id: `${scope}-peer`, githubId: base + 2n, type: 'STUDENT' },
    staff: { id: `${scope}-staff`, githubId: base + 3n, type: 'STAFF' },
    unselected: {
      id: `${scope}-unselected`,
      githubId: base + 4n,
      type: 'UNSELECTED',
    },
  } as const;
  const unregistered = base + 5n;
  const scopedProgramId = `${scope}-program`;
  const teams = {
    mixed: {
      id: `${scope}-mixed`,
      repo: base + 10n,
      leader: people.member,
      members: [people.member],
    },
    authorless: {
      id: `${scope}-authorless`,
      repo: base + 11n,
      leader: people.peer,
      members: [],
    },
    staffOnly: {
      id: `${scope}-staff-only`,
      repo: base + 12n,
      leader: people.peer,
      members: [people.peer],
    },
  };
  await prisma.user.createMany({
    data: Object.entries(people).map(([key, person]) => ({
      ...person,
      nickname: `synthetic-${key}`,
      approvalStatus: person.type === 'STAFF' ? 'APPROVED' : 'NOT_REQUIRED',
    })),
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
  for (const team of Object.values(teams)) {
    await prisma.team.create({
      data: {
        id: team.id,
        programId: scopedProgramId,
        name: team.id,
        leaderId: team.leader.id,
        applicantId: team.leader.id,
        status: 'APPROVED',
        answers: {},
        applicationTemplateVersion: 1,
      },
    });
    await prisma.teamMember.createMany({
      data: team.members.map((person) => ({
        teamId: team.id,
        programId: scopedProgramId,
        userId: person.id,
      })),
    });
    await prisma.githubRepository.create({
      data: {
        id: `${team.id}-repository`,
        githubRepositoryId: team.repo,
        nameWithOwner: `synthetic/${team.id}`,
        source: 'EXTERNAL_PUBLIC',
        visibility: 'PUBLIC',
        teamId: team.id,
        lastSuccessAt: new Date('2026-09-01Z'),
        lastCompleteInventoryObservedAt: new Date('2026-09-01Z'),
      },
    });
    await prisma.repo.create({
      data: {
        githubRepoId: team.repo,
        ownerName: 'synthetic',
        source: 'EXTERNAL_PUBLIC',
      },
    });
  }
  const events: readonly (readonly [
    bigint,
    'COMMIT' | 'PULL_REQUEST',
    bigint | null,
    string,
  ])[] = [
    [teams.mixed.repo, 'COMMIT', people.member.githubId, '2026-08-03'],
    [teams.mixed.repo, 'COMMIT', people.member.githubId, '2026-08-04'],
    [teams.mixed.repo, 'PULL_REQUEST', people.member.githubId, '2026-08-04'],
    [teams.mixed.repo, 'COMMIT', people.left.githubId, '2026-08-05'],
    [teams.mixed.repo, 'COMMIT', people.staff.githubId, '2026-08-20'],
    [teams.mixed.repo, 'COMMIT', people.unselected.githubId, '2026-08-20'],
    [teams.mixed.repo, 'COMMIT', unregistered, '2026-08-20'],
    [teams.mixed.repo, 'COMMIT', null, '2026-08-20'],
    [teams.authorless.repo, 'COMMIT', null, '2026-08-06'],
    [teams.authorless.repo, 'COMMIT', null, '2026-08-07'],
    [teams.staffOnly.repo, 'COMMIT', people.staff.githubId, '2026-08-08'],
    [teams.staffOnly.repo, 'COMMIT', people.unselected.githubId, '2026-08-08'],
    [teams.staffOnly.repo, 'COMMIT', unregistered, '2026-08-08'],
  ];
  await prisma.contributionEvent.createMany({
    data: events.map(([repoId, kind, authorGithubId, day], index) => ({
      repoId,
      kind,
      githubKey: String(index + 1),
      authorGithubId,
      occurredAt: new Date(`${day}T00:00:00Z`),
      firstSeenAt: new Date(`${day}T00:00:00Z`),
    })),
  });
  const platform = new PlatformRepository();
  const activityRepository = new ProgramActivityRepository(prisma, platform);
  const staffView = await new ProgramActivityService(
    new ProgramsRepository(
      prisma,
      platform,
      new ProgramListStatusFilterRepository(),
    ),
    activityRepository,
    Object.create(ProgramViewerService.prototype) as ProgramViewerService,
  ).activity(scopedProgramId, {
    githubId: people.staff.githubId,
    userId: people.staff.id,
    role: 'STAFF',
  });

  const empty = { commitCount: 0, pullRequestCount: 0, releaseCount: 0 };
  expect(staffView).toMatchObject([
    {
      teamId: teams.mixed.id,
      commitCount: 3,
      pullRequestCount: 1,
      releaseCount: 0,
      lastActivityAt: new Date('2026-08-05T00:00:00Z'),
      collectionStatus: 'READY',
      members: [
        {
          githubLogin: 'synthetic-member',
          commitCount: 2,
          pullRequestCount: 1,
          releaseCount: 0,
        },
      ],
      hasIncompleteContributions: true,
    },
    {
      teamId: teams.authorless.id,
      ...empty,
      lastActivityAt: null,
      collectionStatus: 'EMPTY',
      members: [],
      hasIncompleteContributions: false,
    },
    {
      teamId: teams.staffOnly.id,
      ...empty,
      lastActivityAt: null,
      collectionStatus: 'EMPTY',
      members: [{ ...empty }],
      hasIncompleteContributions: false,
    },
  ]);
  await expect(
    new ProgramActivitySummaryService(
      new ProgramActivitySummaryRepository(prisma),
      activityRepository,
    ).summarize([scopedProgramId]),
  ).resolves.toEqual([
    {
      programId: scopedProgramId,
      repositoryCount: 3,
      commitCount: 3,
      pullRequestCount: 1,
      releaseCount: 0,
      lastActivityAt: '2026-08-05T00:00:00.000Z',
      dataAsOf: '2026-09-01T00:00:00.000Z',
    },
  ]);

  const publicMetrics = new PublicProjectMetricsRepository(prisma, platform);
  const repositoryIds = Object.values(teams).map((team) => team.repo);
  const contributors =
    await publicMetrics.findContributorContributionRows(repositoryIds);
  expect(new Set(contributors.map((row) => row.githubUserId))).toEqual(
    new Set([people.member.githubId, people.left.githubId]),
  );
  const repositories =
    await publicMetrics.findRepositoryContributionRows(repositoryIds);
  expect(
    repositories.map((repository) => ({
      repositoryId: repository.repositoryId,
      commitCount: repository.contributions.reduce(
        (sum, row) => sum + row.commitCount,
        0,
      ),
    })),
  ).toEqual(
    expect.arrayContaining([
      { repositoryId: teams.mixed.repo, commitCount: 3 },
      { repositoryId: teams.authorless.repo, commitCount: 0 },
      { repositoryId: teams.staffOnly.repo, commitCount: 0 },
    ]),
  );

  const detail = await new TeamRepository(
    prisma,
    new ProgramTeamRepositoryEvidenceRepository(prisma),
    platform,
    new TeamHistoryRepository(),
  ).findStaffTeamDetail(scopedProgramId, teams.mixed.id);
  expect(detail?.repositoryContributions?.members).toEqual([
    expect.objectContaining({ userId: people.member.id, commitCount: 2 }),
  ]);
});

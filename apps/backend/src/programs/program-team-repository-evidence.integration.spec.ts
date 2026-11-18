import { TeamHistoryRepository } from './team-history.repository';
import { PlatformRepository } from '../platform/platform.repository';
import { TeamRepository } from './team.repository';
import { ProgramTeamRepositoryEvidenceRepository } from './program-team-repository-evidence.repository';
import { randomUUID } from 'node:crypto';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import {
  repositoryContributionTotals,
  seedDailyContributions,
} from '../../test/ledger-contribution.fixture';
import { seedRepo, seedRepos } from '../../test/repo-ledger.fixture';
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
      organizers: ['Synthetic'],
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
  await seedRepos(prisma, [
    {
      githubRepositoryId: githubId + 1n,
      nameWithOwner: 'synthetic/old',
      source: 'ORG_PROVISIONED',
    },
    {
      githubRepositoryId: githubId + 2n,
      nameWithOwner: 'synthetic/current',
      source: 'EXTERNAL_PUBLIC',
      teamId,
    },
  ]);
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

  const history = await new TeamRepository(
    prisma,
    new ProgramTeamRepositoryEvidenceRepository(prisma),
    new PlatformRepository(),
    new TeamHistoryRepository(),
  ).findStaffRepositoryUrlHistory(programId, teamId);

  expect(history?.rows).toHaveLength(1);
  expect(history?.rows[0]?.metadata).toMatchObject({
    actorGithubLogin: 'actor-before-rename',
  });
  expect(
    (await repositoryContributionTotals(prisma, [githubId + 1n])).commitCount,
  ).toBe(900);
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
  ).summarize([programId]);

  expect(summary).toMatchObject({
    programId,
    repositoryCount: 1,
    commitCount: 2,
  });
});

it('counts only student authors in program and public totals', async () => {
  const scope = `student-authors-${randomUUID()}`;
  const base = BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 12)}`);
  const lastSuccessAt = new Date();
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
      organizers: ['Synthetic'],
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
    await seedRepo(prisma, {
      githubRepositoryId: team.repo,
      nameWithOwner: `synthetic/${team.id}`,
      source: 'EXTERNAL_PUBLIC',
      visibility: 'PUBLIC',
      teamId: team.id,
      lastSuccessAt,
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
    ).summarize([scopedProgramId]),
  ).resolves.toEqual([
    {
      programId: scopedProgramId,
      repositoryCount: 3,
      commitCount: 3,
      pullRequestCount: 1,
      releaseCount: 0,
      lastActivityAt: '2026-08-05T00:00:00.000Z',
      dataAsOf: lastSuccessAt.toISOString(),
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
});

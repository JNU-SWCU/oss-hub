import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PlatformRepository } from '../platform/platform.repository';
import { PrismaService } from '../platform/prisma.service';
import { RepositoryProvisionGenerationRepository } from '../platform/repository-provision-generation.repository';
import { SubmissionDashboardSummaryRepository } from './submissions.repository';
import { TeamHistoryRepository } from './team-history.repository';
import { ApplicationsRepository } from './team.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const repository = new SubmissionDashboardSummaryRepository(prisma);
const PREFIX = `submission-summary-it-${Date.now().toString(36)}`;
const PROGRAM = `${PREFIX}-program`;
const EMPTY_PROGRAM = `${PREFIX}-empty`;
const NO_TEAMS_PROGRAM = `${PREFIX}-no-teams`;
const PENDING_PROGRAM_PREFIX = `${PREFIX}-pending`;
const PENDING_APPS_PROGRAM = `${PENDING_PROGRAM_PREFIX}-applications`;
const PENDING_REVIEWS_PROGRAM = `${PENDING_PROGRAM_PREFIX}-reviews`;
const at = new Date('2026-07-01T00:00:00.000Z');
const milestoneStartAt = new Date('2026-07-12T03:04:05.123Z');
const milestoneDueAt = new Date('2026-08-01T06:07:08.456Z');

const id = (label: string) => `${PREFIX}-${label}`;

const milestoneSummary = (
  label: string,
  submittedTeams: number | null,
  totalTeams: number | null,
) => ({
  id: id(label),
  name: id(label),
  startAt: milestoneStartAt.toISOString(),
  dueAt: milestoneDueAt.toISOString(),
  submittedTeams,
  totalTeams,
});

beforeAll(async () => {
  await prisma.$connect();
  await prisma.user.createMany({
    data: ['u1', 'u2', 'u3', 'u4'].map((label, index) => ({
      id: id(label),
      githubId:
        8_964_000_000_000n +
        BigInt(Date.now() % 1_000_000) * 10n +
        BigInt(index),
      nickname: id(label),
    })),
  });
  await prisma.program.createMany({
    data: [
      PROGRAM,
      EMPTY_PROGRAM,
      NO_TEAMS_PROGRAM,
      PENDING_APPS_PROGRAM,
      PENDING_REVIEWS_PROGRAM,
    ].map((programId) => ({
      id: programId,
      name: programId,
      organizers: ['Synthetic integration fixture'],
      category: 'BASIC' as const,
      trackType: 'CURRICULAR' as const,
      applicationTemplateKey: 'capstone-v1',
      applicationTemplateVersion: 1,
      applicationStartAt: at,
      applicationEndAt: new Date('2026-07-10T00:00:00.000Z'),
      startAt: new Date('2026-07-11T00:00:00.000Z'),
      endAt: new Date('2026-09-30T00:00:00.000Z'),
      teamMinSize: 1,
      teamMaxSize: 5,
      description: 'Synthetic submission summary fixture',
    })),
  });
  await prisma.team.createMany({
    data: [
      ['t1', 'u1', 'APPROVED', null],
      ['t2', 'u2', 'APPROVED', null],
      ['t3', 'u3', 'SUBMITTED', null],
      ['t4', 'u4', 'APPROVED', at],
    ].map(([label, user, status, archivedAt]) => ({
      id: id(label as string),
      programId: PROGRAM,
      name: id(label as string),
      leaderId: id(user as string),
      applicantId: id(user as string),
      answers: {},
      applicationTemplateVersion: 1,
      status: status as 'APPROVED' | 'SUBMITTED',
      archivedAt: archivedAt as Date | null,
    })),
  });
  await prisma.milestone.createMany({
    data: (
      [
        ['m1', PROGRAM],
        ['m2', PROGRAM],
        ['m3', PROGRAM],
        ['m4', PROGRAM],
        ['m5', NO_TEAMS_PROGRAM],
      ] as const
    ).map(([label, programId]) => ({
      id: id(label),
      programId,
      name: id(label),
      startAt: milestoneStartAt,
      dueAt: milestoneDueAt,
    })),
  });
  await prisma.requirement.createMany({
    data: [
      ['d1', 'm1', true],
      ['d2', 'm1', true],
      ['d3', 'm1', false],
      ['d-guide', 'm2', false],
      ['d4', 'm3', true],
      ['d5', 'm3', true],
      ['d6', 'm5', true],
    ].map(([label, milestone, required], sortOrder) => ({
      id: id(label as string),
      milestoneId: id(milestone as string),
      name: id(label as string),
      required: required as boolean,
      sortOrder,
    })),
  });
  const submissions: readonly (readonly [
    string,
    string,
    'APPROVED' | 'SUBMITTED' | 'CHANGES_REQUESTED' | 'REJECTED',
  ])[] = [
    ['t1', 'd1', 'APPROVED'],
    ['t1', 'd2', 'SUBMITTED'],
    ['t1', 'd3', 'REJECTED'],
    ['t1', 'd-guide', 'APPROVED'],
    ['t1', 'd4', 'REJECTED'],
    ['t1', 'd5', 'CHANGES_REQUESTED'],
    ['t2', 'd1', 'APPROVED'],
    ['t2', 'd2', 'APPROVED'],
    ['t2', 'd5', 'APPROVED'],
    ['t3', 'd1', 'APPROVED'],
    ['t3', 'd2', 'APPROVED'],
    ['t4', 'd4', 'APPROVED'],
    ['t4', 'd5', 'APPROVED'],
  ];
  await prisma.submission.createMany({
    data: submissions.map(([team, requirement, status]) => ({
      teamId: id(team),
      requirementId: id(requirement),
      submittedById: id('u1'),
      status,
    })),
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

it('counts fully submitted teams per milestone without changing the status totals', async () => {
  const rows = await repository.summarizePrograms([
    PROGRAM,
    EMPTY_PROGRAM,
    NO_TEAMS_PROGRAM,
  ]);

  expect(
    [...rows].sort((left, right) =>
      left.programId.localeCompare(right.programId),
    ),
  ).toEqual(
    [
      {
        programId: PROGRAM,
        milestones: 2,
        milestoneSummaries: [
          milestoneSummary('m1', 2, 2),
          milestoneSummary('m2', null, null),
          milestoneSummary('m3', 1, 2),
          milestoneSummary('m4', null, null),
        ],
        total: 4,
        notSubmitted: 1,
        submitted: 1,
        approved: 1,
        changesRequested: 0,
        rejected: 1,
      },
      {
        programId: EMPTY_PROGRAM,
        milestones: 0,
        milestoneSummaries: [],
        total: 0,
        notSubmitted: 0,
        submitted: 0,
        approved: 0,
        changesRequested: 0,
        rejected: 0,
      },
      {
        programId: NO_TEAMS_PROGRAM,
        milestones: 1,
        milestoneSummaries: [milestoneSummary('m5', 0, 0)],
        total: 0,
        notSubmitted: 0,
        submitted: 0,
        approved: 0,
        changesRequested: 0,
        rejected: 0,
      },
    ].sort((left, right) => left.programId.localeCompare(right.programId)),
  );
});

it('does not query when no program is requested', async () => {
  await expect(repository.summarizePrograms([])).resolves.toEqual([]);
});

it('ranks reviews from earlier milestones with pending applications before pagination', async () => {
  await prisma.team.createMany({
    data: (
      [
        [PENDING_APPS_PROGRAM, 'u1', 'SUBMITTED'],
        [PENDING_APPS_PROGRAM, 'u2', 'SUBMITTED'],
        [PENDING_REVIEWS_PROGRAM, 'u3', 'SUBMITTED'],
        [PENDING_REVIEWS_PROGRAM, 'u4', 'APPROVED'],
      ] as const
    ).map(([programId, user, status]) => ({
      id: id(`pending-team-${user}`),
      programId,
      name: id(`pending-team-${user}`),
      leaderId: id(user),
      applicantId: id(user),
      answers: {},
      applicationTemplateVersion: 1,
      status,
    })),
  });
  const days = [12, 16, 20];
  await prisma.milestone.createMany({
    data: days.map((day) => ({
      id: id(`pending-stage-${day}`),
      programId: PENDING_REVIEWS_PROGRAM,
      name: `Stage ${day}`,
      startAt: new Date(Date.UTC(2026, 6, day)),
      dueAt: new Date(Date.UTC(2026, 6, day + 4)),
    })),
  });
  await prisma.requirement.createMany({
    data: days.map((day) => ({
      id: id(`pending-required-${day}`),
      milestoneId: id(`pending-stage-${day}`),
      name: 'Required document',
      required: true,
      sortOrder: 0,
    })),
  });
  const dashboard = new ApplicationsRepository(
    prisma,
    new TeamHistoryRepository(),
    new RepositoryProvisionGenerationRepository(),
    new PlatformRepository(),
  );
  const page = (number: number) =>
    dashboard.listStaffDashboardSummary({
      page: number,
      pageSize: 1,
      search: PENDING_PROGRAM_PREFIX,
      status: 'in_progress',
      sort: 'pending',
      direction: 'desc',
      now: new Date('2026-07-22T00:00:00.000Z'),
    });
  const submit = (day: number) =>
    prisma.submission.create({
      data: {
        teamId: id('pending-team-u4'),
        requirementId: id(`pending-required-${day}`),
        submittedById: id('u4'),
        status: 'SUBMITTED',
      },
    });

  await expect(page(1)).resolves.toMatchObject({
    total: 2,
    programs: [
      { id: PENDING_APPS_PROGRAM, applications: { pendingApproval: 2 } },
    ],
  });

  await submit(12);
  await expect(page(1)).resolves.toMatchObject({
    programs: [{ id: PENDING_APPS_PROGRAM }],
  });

  await submit(16);
  await expect(
    repository.summarizePrograms([PENDING_REVIEWS_PROGRAM]),
  ).resolves.toMatchObject([
    { programId: PENDING_REVIEWS_PROGRAM, submitted: 2 },
  ]);
  await expect(page(1)).resolves.toMatchObject({
    programs: [
      { id: PENDING_REVIEWS_PROGRAM, applications: { pendingApproval: 1 } },
    ],
  });
  await expect(page(2)).resolves.toMatchObject({
    programs: [{ id: PENDING_APPS_PROGRAM }],
  });
});

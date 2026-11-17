import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../platform/prisma.service';
import { SubmissionDashboardSummaryRepository } from './submissions.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const repository = new SubmissionDashboardSummaryRepository(prisma);
const PREFIX = `submission-summary-it-${Date.now().toString(36)}`;
const PROGRAM = `${PREFIX}-program`;
const EMPTY_PROGRAM = `${PREFIX}-empty`;
const at = new Date('2026-07-01T00:00:00.000Z');

const id = (label: string) => `${PREFIX}-${label}`;

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
    data: [PROGRAM, EMPTY_PROGRAM].map((programId) => ({
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
    data: ['m1', 'm2', 'm3'].map((label) => ({
      id: id(label),
      programId: PROGRAM,
      name: id(label),
      startAt: new Date('2026-07-12T00:00:00.000Z'),
      dueAt: new Date('2026-08-01T00:00:00.000Z'),
    })),
  });
  await prisma.requirement.createMany({
    data: [
      ['d1', 'm1', true],
      ['d2', 'm1', true],
      ['d3', 'm1', false],
      ['d-guide', 'm2', false],
      ['d4', 'm3', true],
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
    'APPROVED' | 'SUBMITTED' | 'REJECTED',
  ])[] = [
    ['t1', 'd1', 'APPROVED'],
    ['t1', 'd2', 'SUBMITTED'],
    ['t1', 'd3', 'REJECTED'],
    ['t1', 'd4', 'REJECTED'],
    ['t2', 'd1', 'APPROVED'],
    ['t2', 'd2', 'APPROVED'],
    ['t3', 'd1', 'APPROVED'],
    ['t4', 'd4', 'APPROVED'],
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

it('folds each approved team and milestone cell to its worst required document status', async () => {
  const rows = await repository.summarizePrograms([PROGRAM, EMPTY_PROGRAM]);

  expect(
    [...rows].sort((left, right) =>
      left.programId.localeCompare(right.programId),
    ),
  ).toEqual(
    [
      {
        programId: PROGRAM,
        approvedApplications: 2,
        milestones: 2,
        total: 4,
        notSubmitted: 1,
        submitted: 1,
        approved: 1,
        changesRequested: 0,
        rejected: 1,
      },
      {
        programId: EMPTY_PROGRAM,
        approvedApplications: 0,
        milestones: 0,
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

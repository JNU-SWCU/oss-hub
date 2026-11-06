import { ProgramScheduleService } from '../programs/program-schedule.service';
import { ProgramTemplatesService } from '../programs/team-application.service';
import { ProgramViewerService } from '../programs/program-viewer.service';
import {
  ProgramListStatusFilterRepository,
  ProgramsRepository,
} from '../programs/programs.repository';
import { PlatformRepository } from '../platform/platform.repository';
import {
  ApplicationStatus,
  ProgramCategory,
  SubmissionStatus,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import type { RepositoriesReadService } from '../github/repositories-read.service';
import { PrismaService } from '../platform/prisma.service';
import { canonicalUserCreateFromLabel } from '../users/canonical-user-fixture';
import { StudentDashboardRepository } from './student-dashboard.repository';
import {
  ProgramsService,
  ProgramCoverUrlService,
} from '../programs/programs.service';
import { StudentDashboardService } from './student-dashboard.service';
import { MilestoneCompletionService } from '../programs/submissions.service';
assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});
const prefix = 'synthetic-dashboard-axes';
const id = (...parts: readonly string[]) => [prefix, ...parts].join('-');
const STUDENT_ID = id('student');
const STUDENT_GITHUB_ID = 4309100091n;
const DOCUMENT_PROGRAM = id('program', 'document');
const DOCUMENT_MILESTONE_FIRST = id('milestone', 'document', 'first');
const DOCUMENT_MILESTONE_SECOND = id('milestone', 'document', 'second');
const REQUIRED_FIRST_A = id('document', 'first', 'a');
const REQUIRED_FIRST_B = id('document', 'first', 'b');
const OPTIONAL_FIRST = id('document', 'first', 'optional');
const REQUIRED_SECOND = id('document', 'second');
const DOCUMENT_APPLICATION = id('application', 'document');
const LEGACY_PROGRAM = id('program', 'legacy');
const LEGACY_MILESTONE = id('milestone', 'legacy');
const LEGACY_SLOT = id('document', 'legacy', 'slot');
const MIXED_MILESTONE = id('milestone', 'mixed');
const MIXED_SLOT = id('document', 'mixed', 'slot');
const MIXED_REQUIRED = id('document', 'mixed', 'required');
const LEGACY_APPLICATION = id('application', 'legacy');
const PROGRAM_IDS = [DOCUMENT_PROGRAM, LEGACY_PROGRAM];
const APPLICATION_IDS = [DOCUMENT_APPLICATION, LEGACY_APPLICATION];
const MILESTONE_IDS = [
  DOCUMENT_MILESTONE_FIRST,
  DOCUMENT_MILESTONE_SECOND,
  LEGACY_MILESTONE,
  MIXED_MILESTONE,
];
const prisma = new PrismaService();
const noRepositories: Pick<RepositoriesReadService, 'getMyRepositories'> = {
  getMyRepositories: () => Promise.resolve([]),
};
const dashboard = new StudentDashboardService(
  new StudentDashboardRepository(prisma, new PlatformRepository()),
  noRepositories,
  new MilestoneCompletionService(),
  new ProgramCoverUrlService(),
);
const programs = new ProgramsService(
  new ProgramsRepository(
    prisma,
    new PlatformRepository(),
    new ProgramListStatusFilterRepository(),
  ),
  new MilestoneCompletionService(),
  new ProgramCoverUrlService(),
  new ProgramScheduleService(),
  new ProgramTemplatesService(),
  Object.create(ProgramViewerService.prototype) as ProgramViewerService,
);
function programRow(programId: string) {
  return {
    startAt: new Date('2026-08-01T00:00:00.000Z'),
    endAt: new Date(
      new Date('2026-08-31T00:00:00.000Z').getTime() + 365 * 86400000,
    ),
    id: programId,
    name: `synthetic ${programId}`,
    organizer: 'synthetic-center',
    category: ProgramCategory.BASIC,
    applicationTemplateKey: 'basic',
    applicationTemplateVersion: 1,
    applicationStartAt: new Date('2026-08-01T00:00:00.000Z'),
    applicationEndAt: new Date('2026-08-31T00:00:00.000Z'),
    description: 'synthetic overview',
  };
}
function documentRow(
  documentId: string,
  milestoneId: string,
  required: boolean,
  sortOrder = 1,
) {
  return {
    id: documentId,
    milestoneId,
    name: `synthetic ${documentId}`,
    required,
    sortOrder,
  };
}
async function setSubmissions(
  teamId: string,
  rows: readonly (readonly [string, SubmissionStatus])[],
): Promise<void> {
  await prisma.submission.deleteMany({
    where: { teamId },
  });
  await prisma.submission.createMany({
    data: rows.map(([milestoneDocumentId, status]) => ({
      requirementId: milestoneDocumentId,
      teamId,
      status,
      submittedById: STUDENT_ID,
    })),
  });
}

async function nextMilestoneOf(teamId: string) {
  const items = await dashboard.getStudentDashboard(STUDENT_GITHUB_ID);
  return items.find((item) => item.teamId === teamId)?.nextMilestone;
}
async function cleanup(): Promise<void> {
  await prisma.submission.deleteMany({
    where: { teamId: { in: APPLICATION_IDS } },
  });
  await prisma.teamMember.deleteMany({
    where: { teamId: { in: APPLICATION_IDS } },
  });
  await prisma.team.deleteMany({
    where: { id: { in: APPLICATION_IDS } },
  });
  await prisma.requirement.deleteMany({
    where: { milestoneId: { in: MILESTONE_IDS } },
  });
  await prisma.milestone.deleteMany({ where: { id: { in: MILESTONE_IDS } } });
  await prisma.program.deleteMany({ where: { id: { in: PROGRAM_IDS } } });
  await prisma.user.deleteMany({ where: { id: STUDENT_ID } });
}
async function seed(): Promise<void> {
  await prisma.user.create({
    data: canonicalUserCreateFromLabel('STUDENT', {
      id: STUDENT_ID,
      githubId: STUDENT_GITHUB_ID,
      nickname: prefix,
    }),
  });
  await prisma.program.createMany({ data: PROGRAM_IDS.map(programRow) });
  await prisma.milestone.createMany({
    data: [
      {
        startAt: new Date('2026-08-01T00:00:00.000Z'),
        id: DOCUMENT_MILESTONE_FIRST,
        programId: DOCUMENT_PROGRAM,
        name: '서류 1차',
        dueAt: new Date('2026-09-01T00:00:00.000Z'),
      },
      {
        startAt: new Date('2026-08-01T00:00:00.000Z'),
        id: DOCUMENT_MILESTONE_SECOND,
        programId: DOCUMENT_PROGRAM,
        name: '서류 2차',
        dueAt: new Date('2026-09-08T00:00:00.000Z'),
      },
      {
        startAt: new Date('2026-08-01T00:00:00.000Z'),
        id: LEGACY_MILESTONE,
        programId: LEGACY_PROGRAM,
        name: '옛 단일 제출',
        dueAt: new Date('2026-09-01T00:00:00.000Z'),
      },
      {
        startAt: new Date('2026-08-01T00:00:00.000Z'),
        id: MIXED_MILESTONE,
        programId: LEGACY_PROGRAM,
        name: '두 축 혼재',
        dueAt: new Date('2026-09-08T00:00:00.000Z'),
      },
    ],
  });
  await prisma.requirement.createMany({
    data: [
      documentRow(REQUIRED_FIRST_A, DOCUMENT_MILESTONE_FIRST, true),
      documentRow(REQUIRED_FIRST_B, DOCUMENT_MILESTONE_FIRST, true),
      documentRow(OPTIONAL_FIRST, DOCUMENT_MILESTONE_FIRST, false),
      documentRow(REQUIRED_SECOND, DOCUMENT_MILESTONE_SECOND, true),
      documentRow(MIXED_REQUIRED, MIXED_MILESTONE, true),
      documentRow(LEGACY_SLOT, LEGACY_MILESTONE, true, -1),
      documentRow(MIXED_SLOT, MIXED_MILESTONE, true, -1),
    ],
  });
  await prisma.team.createMany({
    data: APPLICATION_IDS.map((teamId, index) => ({
      id: teamId,
      programId: PROGRAM_IDS[index] ?? DOCUMENT_PROGRAM,
      name: `${teamId}-team`,
      leaderId: STUDENT_ID,
      applicantId: STUDENT_ID,
      answers: {},
      applicationTemplateVersion: 1,
      status: ApplicationStatus.APPROVED,
    })),
  });
  await prisma.teamMember.createMany({
    data: APPLICATION_IDS.map((teamId, index) => ({
      teamId,
      programId: PROGRAM_IDS[index] ?? DOCUMENT_PROGRAM,
      userId: STUDENT_ID,
    })),
  });
}
describe('StudentDashboardService milestone axes integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await cleanup();
    await seed();
  });
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });
  it('projects grace only from unsubmitted required documents and clears it after submission', async () => {
    const grace = new Date('2026-09-05T00:00:00.000Z');
    const later = new Date('2026-09-07T00:00:00.000Z');
    await prisma.requirement.update({
      where: { id: REQUIRED_FIRST_A },
      data: { graceDueAt: grace },
    });
    await prisma.requirement.update({
      where: { id: OPTIONAL_FIRST },
      data: { graceDueAt: later },
    });
    await setSubmissions(DOCUMENT_APPLICATION, [
      [REQUIRED_FIRST_B, SubmissionStatus.APPROVED],
    ]);
    expect(await nextMilestoneOf(DOCUMENT_APPLICATION)).toMatchObject({
      dueAt: new Date('2026-09-01T00:00:00.000Z'),
      lateSubmissionDueAt: grace,
    });
    await setSubmissions(DOCUMENT_APPLICATION, [
      [REQUIRED_FIRST_A, SubmissionStatus.SUBMITTED],
      [REQUIRED_FIRST_B, SubmissionStatus.APPROVED],
    ]);
    expect(await nextMilestoneOf(DOCUMENT_APPLICATION)).toMatchObject({
      lateSubmissionDueAt: null,
    });
    await prisma.requirement.updateMany({
      where: { id: { in: [REQUIRED_FIRST_A, OPTIONAL_FIRST] } },
      data: { graceDueAt: null },
    });
  });
  it('holds the first milestone until every required document is approved', async () => {
    await setSubmissions(DOCUMENT_APPLICATION, [
      [REQUIRED_FIRST_A, SubmissionStatus.APPROVED],
    ]);
    expect(await nextMilestoneOf(DOCUMENT_APPLICATION)).toMatchObject({
      id: DOCUMENT_MILESTONE_FIRST,
      submissionStatus: 'NOT_SUBMITTED',
    });
  });
  it('advances to the second milestone once the first milestone is approved', async () => {
    await setSubmissions(DOCUMENT_APPLICATION, [
      [REQUIRED_FIRST_A, SubmissionStatus.APPROVED],
      [REQUIRED_FIRST_B, SubmissionStatus.APPROVED],
    ]);
    expect(await nextMilestoneOf(DOCUMENT_APPLICATION)).toMatchObject({
      id: DOCUMENT_MILESTONE_SECOND,
      submissionStatus: 'NOT_SUBMITTED',
    });
  });
  it('empties the next milestone when every milestone is approved', async () => {
    await setSubmissions(DOCUMENT_APPLICATION, [
      [REQUIRED_FIRST_A, SubmissionStatus.APPROVED],
      [REQUIRED_FIRST_B, SubmissionStatus.APPROVED],
      [REQUIRED_SECOND, SubmissionStatus.APPROVED],
    ]);
    expect(await nextMilestoneOf(DOCUMENT_APPLICATION)).toBeNull();
  });
  it('leaves the unsubmitted optional document out of the completion check', async () => {
    await setSubmissions(DOCUMENT_APPLICATION, [
      [REQUIRED_FIRST_A, SubmissionStatus.APPROVED],
      [REQUIRED_FIRST_B, SubmissionStatus.APPROVED],
      [REQUIRED_SECOND, SubmissionStatus.APPROVED],
      [OPTIONAL_FIRST, SubmissionStatus.CHANGES_REQUESTED],
    ]);
    expect(await nextMilestoneOf(DOCUMENT_APPLICATION)).toBeNull();
  });
  it('keeps legacy single-submission milestones on their own axis', async () => {
    await setSubmissions(LEGACY_APPLICATION, [
      [MIXED_SLOT, SubmissionStatus.APPROVED],
      [MIXED_REQUIRED, SubmissionStatus.APPROVED],
    ]);
    expect(await nextMilestoneOf(LEGACY_APPLICATION)).toMatchObject({
      id: LEGACY_MILESTONE,
      submissionStatus: 'NOT_SUBMITTED',
    });
    await setSubmissions(LEGACY_APPLICATION, [
      [LEGACY_SLOT, SubmissionStatus.APPROVED],
      [MIXED_SLOT, SubmissionStatus.APPROVED],
      [MIXED_REQUIRED, SubmissionStatus.APPROVED],
    ]);
    expect(await nextMilestoneOf(LEGACY_APPLICATION)).toBeNull();
  });
  it('reports the same status as the program detail for a two-axis milestone', async () => {
    await setSubmissions(LEGACY_APPLICATION, [
      [LEGACY_SLOT, SubmissionStatus.APPROVED],
      [MIXED_SLOT, SubmissionStatus.APPROVED],
      [MIXED_REQUIRED, SubmissionStatus.SUBMITTED],
    ]);
    const detail = await programs.detail(LEGACY_PROGRAM, {
      githubId: STUDENT_GITHUB_ID,
      userId: STUDENT_ID,
      role: 'STUDENT',
    });
    const detailStatus = detail.milestones.find(
      (milestone) => milestone.id === MIXED_MILESTONE,
    )?.viewerSubmissionStatus;
    expect(detailStatus).toBe(SubmissionStatus.SUBMITTED);
    expect(await nextMilestoneOf(LEGACY_APPLICATION)).toMatchObject({
      id: MIXED_MILESTONE,
      submissionStatus: detailStatus,
    });
  });
});

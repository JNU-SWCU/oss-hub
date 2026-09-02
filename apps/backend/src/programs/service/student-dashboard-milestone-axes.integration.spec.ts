import {
  ApplicationStatus,
  MilestoneDocumentKind,
  MilestoneSubmissionType,
  ProgramCategory,
  SubmissionStatus,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../../test/integration-database.guard';
import type { RepositoriesReadPort } from '../../github/repositories-read.port';
import { PrismaService } from '../../prisma/prisma.service';
import { canonicalUserCreateFromLabel } from '../../users/canonical-user-fixture';
import { ProgramsRepository } from '../repository/programs.repository';
import { ProgramsService } from './programs.service';
import { StudentDashboardService } from './student-dashboard.service';

/**
 * 대시보드의 「다음 마일스톤」이 두 제출 축을 실제 DB에서 함께 보는지 확인한다(#1091).
 *
 * 이 확인은 단위 테스트로 대신할 수 없다 — 결함이 조회 조건 자체에 있었고, prisma를 mock 하면
 * `where` 가 무엇이든 fixture 가 그대로 돌아와 조건이 검증되지 않는다.
 */
assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prefix = 'synthetic-dashboard-axes';
const id = (...parts: readonly string[]) => [prefix, ...parts].join('-');

const STUDENT_ID = id('student');
const STUDENT_GITHUB_ID = 4_309_100_091n;

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
const noRepositories: RepositoriesReadPort = {
  getMyRepositories: () => Promise.resolve([]),
};
const dashboard = new StudentDashboardService(prisma, noRepositories);
const programs = new ProgramsService(new ProgramsRepository(prisma));

function programRow(programId: string) {
  return {
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
  kind: MilestoneDocumentKind = MilestoneDocumentKind.DOCUMENT,
) {
  return {
    id: documentId,
    milestoneId,
    name: `synthetic ${documentId}`,
    required,
    sortOrder: kind === MilestoneDocumentKind.DOCUMENT ? 1 : -1,
    kind,
  };
}

/** 이 신청의 제출을 통째로 갈아 끼운다 — 테스트끼리 상태를 물려받지 않게 한다. */
async function setSubmissions(
  applicationId: string,
  rows: readonly (readonly [string, SubmissionStatus])[],
): Promise<void> {
  await prisma.milestoneDocumentSubmission.deleteMany({
    where: { applicationId },
  });
  await prisma.milestoneDocumentSubmission.createMany({
    data: rows.map(([milestoneDocumentId, status]) => ({
      milestoneDocumentId,
      applicationId,
      status,
      submittedById: STUDENT_ID,
    })),
  });
}

async function nextMilestoneOf(applicationId: string) {
  const items = await dashboard.getStudentDashboard(STUDENT_GITHUB_ID);
  return items.find((item) => item.applicationId === applicationId)
    ?.nextMilestone;
}

async function cleanup(): Promise<void> {
  await prisma.milestoneDocumentSubmission.deleteMany({
    where: { applicationId: { in: APPLICATION_IDS } },
  });
  await prisma.application.deleteMany({
    where: { id: { in: APPLICATION_IDS } },
  });
  await prisma.teamMember.deleteMany({
    where: { teamId: { in: APPLICATION_IDS.map((each) => `${each}-team`) } },
  });
  await prisma.team.deleteMany({
    where: { id: { in: APPLICATION_IDS.map((each) => `${each}-team`) } },
  });
  await prisma.milestoneDocument.deleteMany({
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
      // 새 방식 — `submissionType` 이 없고 서류 항목으로만 완료한다.
      {
        id: DOCUMENT_MILESTONE_FIRST,
        programId: DOCUMENT_PROGRAM,
        name: '서류 1차',
        dueAt: new Date('2026-09-01T00:00:00.000Z'),
        submissionType: null,
      },
      {
        id: DOCUMENT_MILESTONE_SECOND,
        programId: DOCUMENT_PROGRAM,
        name: '서류 2차',
        dueAt: new Date('2026-09-08T00:00:00.000Z'),
        submissionType: null,
      },
      // 옛 방식 — 단일 제출 축만 쓴다.
      {
        id: LEGACY_MILESTONE,
        programId: LEGACY_PROGRAM,
        name: '옛 단일 제출',
        dueAt: new Date('2026-09-01T00:00:00.000Z'),
        submissionType: MilestoneSubmissionType.FILE,
      },
      // #820 전환기 — 단일 제출 축과 필수 서류가 함께 살아 있다.
      {
        id: MIXED_MILESTONE,
        programId: LEGACY_PROGRAM,
        name: '두 축 혼재',
        dueAt: new Date('2026-09-08T00:00:00.000Z'),
        submissionType: MilestoneSubmissionType.FILE,
      },
    ],
  });
  await prisma.milestoneDocument.createMany({
    data: [
      documentRow(REQUIRED_FIRST_A, DOCUMENT_MILESTONE_FIRST, true),
      documentRow(REQUIRED_FIRST_B, DOCUMENT_MILESTONE_FIRST, true),
      documentRow(OPTIONAL_FIRST, DOCUMENT_MILESTONE_FIRST, false),
      documentRow(REQUIRED_SECOND, DOCUMENT_MILESTONE_SECOND, true),
      documentRow(MIXED_REQUIRED, MIXED_MILESTONE, true),
      documentRow(
        LEGACY_SLOT,
        LEGACY_MILESTONE,
        true,
        MilestoneDocumentKind.LEGACY_MILESTONE_SUBMISSION,
      ),
      documentRow(
        MIXED_SLOT,
        MIXED_MILESTONE,
        true,
        MilestoneDocumentKind.LEGACY_MILESTONE_SUBMISSION,
      ),
    ],
  });
  await prisma.team.createMany({
    data: APPLICATION_IDS.map((applicationId, index) => ({
      id: `${applicationId}-team`,
      programId: PROGRAM_IDS[index] ?? DOCUMENT_PROGRAM,
      name: `${applicationId}-team`,
      joinCodeDigest: `${applicationId}-digest`,
      leaderId: STUDENT_ID,
    })),
  });
  await prisma.teamMember.createMany({
    data: APPLICATION_IDS.map((applicationId, index) => ({
      id: `${applicationId}-member`,
      teamId: `${applicationId}-team`,
      programId: PROGRAM_IDS[index] ?? DOCUMENT_PROGRAM,
      userId: STUDENT_ID,
    })),
  });
  await prisma.application.createMany({
    data: APPLICATION_IDS.map((applicationId, index) => ({
      id: applicationId,
      programId: PROGRAM_IDS[index] ?? DOCUMENT_PROGRAM,
      applicantId: STUDENT_ID,
      teamId: `${applicationId}-team`,
      answers: {},
      applicationTemplateVersion: 1,
      status: ApplicationStatus.APPROVED,
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

  /**
   * 두 화면이 같은 말을 하는가. 대시보드가 옛 슬롯만 보던 동안 이 칸은 대시보드에서 승인,
   * 프로그램 상세에서 제출됨으로 갈라졌다.
   */
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

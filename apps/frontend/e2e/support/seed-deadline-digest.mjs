import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(here, '..', '..', '..', 'backend');
const require = createRequire(join(backendRoot, 'package.json'));
const {
  ApplicationStatus,
  MilestoneDocumentKind,
  MilestoneSubmissionType,
  PrismaClient,
  ProgramCategory,
} = require('@prisma/client');

const prefix = 'seed:e2e:deadline-digest';
const programId = `${prefix}:program`;
const milestoneId = `${prefix}:milestone`;
const documentId = `${prefix}:document`;
const teamId = `${prefix}:team`;
const applicationId = `${prefix}:application`;
const memberId = `${prefix}:member`;
const staffId = 'seed:auth:staff-revocable';
const studentId = 'seed:auth:student-confirmed';
const prisma = new PrismaClient();

async function main() {
  await prisma.notification.deleteMany({
    where: { userId: { in: [staffId, studentId] }, type: 'DEADLINE_DIGEST' },
  });
  // 제출 원장은 Submission에서 MilestoneDocumentSubmission으로 이관됐다
  // (20260830180000_contract_legacy_submissions가 옛 테이블을 지웠다).
  await prisma.milestoneDocumentSubmission.deleteMany({
    where: { applicationId },
  });
  await prisma.application.deleteMany({ where: { id: applicationId } });
  await prisma.teamMember.deleteMany({ where: { id: memberId } });
  await prisma.team.deleteMany({ where: { id: teamId } });
  await prisma.milestoneDocument.deleteMany({ where: { id: documentId } });
  await prisma.milestone.deleteMany({ where: { id: milestoneId } });
  await prisma.program.deleteMany({ where: { id: programId } });

  await prisma.program.create({
    data: {
      id: programId,
      name: 'E2E 마감 알림 프로그램',
      organizer: 'synthetic-e2e',
      category: ProgramCategory.BASIC,
      applicationTemplateKey: 'basic',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2026-01-01T00:00:00.000Z'),
      applicationEndAt: new Date('2026-12-31T00:00:00.000Z'),
      repositoryProvisioningEnabled: false,
      description: 'deadline digest e2e',
      notifyOnDeadline: true,
    },
  });
  await prisma.milestone.create({
    data: {
      id: milestoneId,
      programId,
      name: 'E2E 최종 제출',
      dueAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
      submissionType: MilestoneSubmissionType.TEXT,
    },
  });
  // 다이제스트 대상은 마일스톤이 아니라 **필수 서류 항목**이다. 이 행이 없으면
  // findAutomaticProgramIds가 프로그램을 아예 고르지 않고 buildDeadlineEligibility도
  // requiredDocumentIds가 비어 마일스톤을 버린다 — 시드는 성공하는데 알림이 0건이 된다.
  // kind는 DOCUMENT여야 한다. LEGACY_MILESTONE_SUBMISSION 슬롯은 두 조회 모두 제외한다.
  await prisma.milestoneDocument.create({
    data: {
      id: documentId,
      milestoneId,
      name: 'E2E 최종 보고서',
      required: true,
      sortOrder: 0,
      kind: MilestoneDocumentKind.DOCUMENT,
    },
  });

  const [staff, student] = await Promise.all([
    prisma.user.findUnique({ where: { id: staffId } }),
    prisma.user.findUnique({ where: { id: studentId } }),
  ]);
  if (!staff || !student) {
    throw new Error('auth seed personas missing');
  }
  await Promise.all([
    prisma.user.update({
      where: { id: staffId },
      data: { notificationEmail: 'staff@example.test', notifyEnabled: true },
    }),
    prisma.user.update({
      where: { id: studentId },
      data: { notificationEmail: 'student@example.test', notifyEnabled: true },
    }),
  ]);
  await prisma.team.create({
    data: {
      id: teamId,
      programId,
      name: 'E2E 마감 팀',
      joinCodeDigest: `${prefix}:digest`,
      leaderId: studentId,
    },
  });
  await prisma.teamMember.create({
    data: { id: memberId, teamId, programId, userId: studentId },
  });
  await prisma.application.create({
    data: {
      id: applicationId,
      programId,
      applicantId: studentId,
      teamId,
      answers: { synthetic: true },
      applicationTemplateVersion: 1,
      status: ApplicationStatus.APPROVED,
    },
  });
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());

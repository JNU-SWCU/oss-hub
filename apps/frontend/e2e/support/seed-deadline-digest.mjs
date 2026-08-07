/**
 * auth 시드 위에 마감 알림 e2e용 프로그램·마일스톤·신청을 얹는다.
 * DATABASE_URL 필수.
 */
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(here, '..', '..', '..', 'backend');
const require = createRequire(join(backendRoot, 'package.json'));
const {
  PrismaClient,
  ApplicationStatus,
  MilestoneSubmissionType,
  ProgramCategory,
} = require('@prisma/client');

const PREFIX = 'seed:e2e:deadline-digest';
const PROGRAM_ID = `${PREFIX}:program`;
const MILESTONE_ID = `${PREFIX}:milestone`;
const TEAM_ID = `${PREFIX}:team`;
const APPLICATION_ID = `${PREFIX}:application`;
const MEMBER_ID = `${PREFIX}:member`;
const STAFF_ID = 'seed:auth:staff-revocable';
const STUDENT_ID = 'seed:auth:student-confirmed';

const prisma = new PrismaClient();

async function main() {
  const dueAt = new Date(Date.now() + 12 * 60 * 60 * 1000);

  await prisma.notification.deleteMany({
    where: { userId: { in: [STAFF_ID, STUDENT_ID] }, type: 'DEADLINE_DIGEST' },
  });
  await prisma.submission.deleteMany({
    where: { applicationId: APPLICATION_ID },
  });
  await prisma.application.deleteMany({ where: { id: APPLICATION_ID } });
  await prisma.teamMember.deleteMany({ where: { id: MEMBER_ID } });
  await prisma.team.deleteMany({ where: { id: TEAM_ID } });
  await prisma.milestone.deleteMany({ where: { id: MILESTONE_ID } });
  await prisma.program.deleteMany({ where: { id: PROGRAM_ID } });

  await prisma.program.create({
    data: {
      id: PROGRAM_ID,
      name: 'E2E 마감 알림 프로그램',
      organizer: 'synthetic-e2e',
      category: ProgramCategory.BASIC,
      applicationTemplateKey: 'basic',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2026-01-01T00:00:00.000Z'),
      applicationEndAt: new Date('2026-12-31T00:00:00.000Z'),
      teamMinSize: null,
      teamMaxSize: null,
      repositoryProvisioningEnabled: false,
      description: 'deadline digest e2e',
      notifyOnDeadline: true,
    },
  });
  await prisma.milestone.create({
    data: {
      id: MILESTONE_ID,
      programId: PROGRAM_ID,
      name: 'E2E 최종 제출',
      dueAt,
      submissionType: MilestoneSubmissionType.TEXT,
    },
  });

  const staff = await prisma.user.findUnique({ where: { id: STAFF_ID } });
  const student = await prisma.user.findUnique({ where: { id: STUDENT_ID } });
  if (!staff || !student) {
    throw new Error('auth seed personas missing — run SEED_PROFILE=auth first');
  }

  await prisma.user.update({
    where: { id: STAFF_ID },
    data: {
      notificationEmail: 'staff-revocable@example.com',
      notifyEnabled: true,
    },
  });
  await prisma.user.update({
    where: { id: STUDENT_ID },
    data: {
      notificationEmail: 'student-confirmed@example.com',
      notifyEnabled: true,
    },
  });

  await prisma.team.create({
    data: {
      id: TEAM_ID,
      programId: PROGRAM_ID,
      name: 'E2E 마감 팀',
      joinCodeDigest: `${PREFIX}:digest`,
      leaderId: STUDENT_ID,
    },
  });
  await prisma.teamMember.create({
    data: {
      id: MEMBER_ID,
      teamId: TEAM_ID,
      programId: PROGRAM_ID,
      userId: STUDENT_ID,
    },
  });
  await prisma.application.create({
    data: {
      id: APPLICATION_ID,
      programId: PROGRAM_ID,
      applicantId: STUDENT_ID,
      teamId: TEAM_ID,
      answers: { seedPlaceholder: true },
      applicationTemplateVersion: 1,
      status: ApplicationStatus.APPROVED,
    },
  });

  console.log('deadline-digest e2e seed ok');
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import {
  AccountStatus,
  ApplicationStatus,
  MilestoneSubmissionType,
  ProgramCategory,
  Role,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import { DeadlineDigestRepository } from './deadline-digest.repository';
import { DeadlineDigestService } from './deadline-digest.service';
import type { DeadlineDigestMail, MailSender } from './mail-sender.port';
import { NotificationSettingsRepository } from './notification-settings.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const NOTIFY_PROGRAM = 'test:notifications:program:notify';
const SILENT_PROGRAM = 'test:notifications:program:silent';
const NOTIFY_MILESTONE = 'test:notifications:milestone:notify';
const SILENT_MILESTONE = 'test:notifications:milestone:silent';
const STAFF_ON = 'test:notifications:staff-on';
const STAFF_OFF = 'test:notifications:staff-off';
const ADMIN_ON = 'test:notifications:admin-on';
const STUDENT_MISSING = 'test:notifications:student-missing';
const STUDENT_SUBMITTED = 'test:notifications:student-submitted';
const STUDENT_OFF = 'test:notifications:student-off';

const STAFF_ON_GITHUB = 9_600_000_000_127_001n;
const STUDENT_MISSING_GITHUB = 9_600_000_000_127_003n;
const STUDENT_SUBMITTED_GITHUB = 9_600_000_000_127_005n;
const STUDENT_OFF_GITHUB = 9_600_000_000_127_006n;
const now = new Date('2026-08-14T00:00:00.000Z');
const windowEnd = new Date('2026-08-15T00:00:00.000Z');
const dueSoon = new Date('2026-08-14T12:00:00.000Z');
const MISSING_APPLICATION = 'test:notifications:application:missing';
const SUBMITTED_APPLICATION = 'test:notifications:application:submitted';
const OFF_APPLICATION = 'test:notifications:application:off';
const SUBMISSION = 'test:notifications:submission';

const prisma = new PrismaService();
const repository = new DeadlineDigestRepository(prisma);
const settingsRepository = new NotificationSettingsRepository(prisma);

class RecordingMailSender implements MailSender {
  readonly sent: DeadlineDigestMail[] = [];

  send(mail: DeadlineDigestMail): Promise<void> {
    this.sent.push(mail);
    return Promise.resolve();
  }
}

function programData(id: string, notifyOnDeadline: boolean) {
  return {
    id,
    name: `synthetic ${id}`,
    organizer: 'synthetic-center',
    category: ProgramCategory.BASIC,
    applicationTemplateKey: 'basic',
    applicationTemplateVersion: 1,
    applicationStartAt: new Date('2026-08-01T00:00:00.000Z'),
    applicationEndAt: new Date('2026-08-31T00:00:00.000Z'),
    teamMinSize: null,
    teamMaxSize: null,
    repositoryProvisioningEnabled: false,
    description: 'overview',
    notifyOnDeadline,
  };
}

function staffData(
  id: string,
  githubId: bigint,
  notifyEnabled: boolean,
  notificationEmail: string | null,
  role: Role = Role.STAFF,
) {
  return {
    id,
    githubId,
    nickname: `synthetic-${id}`,
    role,
    accountStatus: AccountStatus.ACTIVE,
    notifyEnabled,
    notificationEmail,
  };
}

async function cleanup(): Promise<void> {
  await prisma.notification.deleteMany({
    where: {
      userId: {
        in: [
          STAFF_ON,
          STAFF_OFF,
          ADMIN_ON,
          STUDENT_MISSING,
          STUDENT_SUBMITTED,
          STUDENT_OFF,
        ],
      },
    },
  });
  await prisma.submission.deleteMany({ where: { id: SUBMISSION } });
  await prisma.application.deleteMany({
    where: {
      id: { in: [MISSING_APPLICATION, SUBMITTED_APPLICATION, OFF_APPLICATION] },
    },
  });
  await prisma.teamMember.deleteMany({
    where: {
      teamId: {
        in: [
          `${MISSING_APPLICATION}-team`,
          `${SUBMITTED_APPLICATION}-team`,
          `${OFF_APPLICATION}-team`,
        ],
      },
    },
  });
  await prisma.team.deleteMany({
    where: {
      id: {
        in: [
          `${MISSING_APPLICATION}-team`,
          `${SUBMITTED_APPLICATION}-team`,
          `${OFF_APPLICATION}-team`,
        ],
      },
    },
  });
  await prisma.milestone.deleteMany({
    where: { id: { in: [NOTIFY_MILESTONE, SILENT_MILESTONE] } },
  });
  await prisma.program.deleteMany({
    where: { id: { in: [NOTIFY_PROGRAM, SILENT_PROGRAM] } },
  });
  await prisma.user.deleteMany({
    where: {
      id: {
        in: [
          STAFF_ON,
          STAFF_OFF,
          ADMIN_ON,
          STUDENT_MISSING,
          STUDENT_SUBMITTED,
          STUDENT_OFF,
        ],
      },
    },
  });
}

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await cleanup();
  await prisma.program.create({ data: programData(NOTIFY_PROGRAM, true) });
  await prisma.program.create({ data: programData(SILENT_PROGRAM, false) });
  await prisma.milestone.create({
    data: {
      id: NOTIFY_MILESTONE,
      programId: NOTIFY_PROGRAM,
      name: '최종 제출',
      dueAt: dueSoon,
      submissionType: MilestoneSubmissionType.TEXT,
    },
  });
  await prisma.milestone.create({
    data: {
      id: SILENT_MILESTONE,
      programId: SILENT_PROGRAM,
      name: '중간 제출',
      dueAt: dueSoon,
      submissionType: MilestoneSubmissionType.TEXT,
    },
  });
  await prisma.user.create({
    data: staffData(STAFF_ON, STAFF_ON_GITHUB, true, 'staff-on@example.com'),
  });
  await prisma.user.create({
    data: staffData(
      STAFF_OFF,
      9_600_000_000_127_002n,
      false,
      'staff-off@example.com',
    ),
  });
  await prisma.user.create({
    data: staffData(
      ADMIN_ON,
      9_600_000_000_127_004n,
      true,
      'admin-on@example.com',
      Role.ADMIN,
    ),
  });
  await prisma.user.create({
    data: staffData(
      STUDENT_MISSING,
      STUDENT_MISSING_GITHUB,
      true,
      'student-missing@example.com',
      Role.STUDENT,
    ),
  });
  await prisma.user.create({
    data: staffData(
      STUDENT_SUBMITTED,
      STUDENT_SUBMITTED_GITHUB,
      true,
      'student-submitted@example.com',
      Role.STUDENT,
    ),
  });
  await prisma.user.create({
    data: staffData(
      STUDENT_OFF,
      STUDENT_OFF_GITHUB,
      false,
      'student-off@example.com',
      Role.STUDENT,
    ),
  });
  const applicationTeamFixtures = [
    {
      applicationId: MISSING_APPLICATION,
      applicantId: STUDENT_MISSING,
    },
    {
      applicationId: SUBMITTED_APPLICATION,
      applicantId: STUDENT_SUBMITTED,
    },
    {
      applicationId: OFF_APPLICATION,
      applicantId: STUDENT_OFF,
    },
  ] as const;
  await prisma.team.createMany({
    data: applicationTeamFixtures.map(({ applicationId, applicantId }) => ({
      id: `${applicationId}-team`,
      programId: NOTIFY_PROGRAM,
      name: `${applicationId}-team`,
      joinCodeDigest: `${applicationId}-digest`,
      leaderId: applicantId,
    })),
  });
  await prisma.teamMember.createMany({
    data: applicationTeamFixtures.map(({ applicationId, applicantId }) => ({
      id: `${applicationId}-member`,
      teamId: `${applicationId}-team`,
      programId: NOTIFY_PROGRAM,
      userId: applicantId,
    })),
  });
  await prisma.application.createMany({
    data: applicationTeamFixtures.map(({ applicationId, applicantId }) => ({
      id: applicationId,
      programId: NOTIFY_PROGRAM,
      applicantId,
      teamId: `${applicationId}-team`,
      answers: {},
      applicationTemplateVersion: 1,
      status: ApplicationStatus.APPROVED,
    })),
  });
  await prisma.submission.create({
    data: {
      id: SUBMISSION,
      applicationId: SUBMITTED_APPLICATION,
      milestoneId: NOTIFY_MILESTONE,
    },
  });
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

it('notifyOnDeadline 프로그램의 마감 임박 마일스톤만 포함한다', async () => {
  const milestones = await repository.findUpcomingDeadlineMilestones(
    now,
    windowEnd,
  );
  expect(milestones).toHaveLength(1);
  expect(milestones[0]?.milestoneName).toBe('최종 제출');
});

it('교직원과 미제출 동의 학생에게만 발송하고 SENT를 기록한다(제출자·opt-out 제외)', async () => {
  const mailSender = new RecordingMailSender();
  const service = new DeadlineDigestService(repository, mailSender);

  await service.sendDeadlineDigests(now);

  expect(mailSender.sent.map((mail) => mail.to).sort()).toEqual([
    'admin-on@example.com',
    'staff-on@example.com',
    'student-missing@example.com',
  ]);
  const staffMail = mailSender.sent.find(
    (mail) => mail.to === 'staff-on@example.com',
  );
  expect(staffMail?.body).toContain('미제출자:');
  expect(staffMail?.body).toContain(
    'synthetic-test:notifications:student-missing',
  );
  expect(staffMail?.body).toContain('synthetic-test:notifications:student-off');
  expect(staffMail?.body).toContain('2026. 08. 14. 21:00 (Asia/Seoul)');
  const notifications = await prisma.notification.findMany({
    where: {
      userId: {
        in: [
          STAFF_ON,
          STAFF_OFF,
          ADMIN_ON,
          STUDENT_MISSING,
          STUDENT_SUBMITTED,
          STUDENT_OFF,
        ],
      },
    },
    orderBy: { userId: 'asc' },
  });
  expect(notifications).toHaveLength(3);
  expect(notifications.map((row) => row.userId).sort()).toEqual([
    ADMIN_ON,
    STAFF_ON,
    STUDENT_MISSING,
  ]);
  for (const row of notifications) {
    expect(row).toMatchObject({
      status: 'SENT',
      type: 'DEADLINE_DIGEST',
      channel: 'EMAIL',
    });
    expect(row.sentAt).not.toBeNull();
  }
  await service.sendDeadlineDigests(now);

  expect(mailSender.sent).toHaveLength(3);
  expect(
    await prisma.notification.count({ where: { type: 'DEADLINE_DIGEST' } }),
  ).toBe(3);
});

it('수신 이메일을 변경하면 다음 발송 대상 주소가 새 값이 된다', async () => {
  await settingsRepository.updateByGithubId(STAFF_ON_GITHUB, {
    notificationEmail: 'changed@example.com',
    notifyEnabled: true,
  });
  const mailSender = new RecordingMailSender();
  const service = new DeadlineDigestService(repository, mailSender);

  await service.sendDeadlineDigests(now);

  expect(mailSender.sent.map((mail) => mail.to).sort()).toEqual([
    'admin-on@example.com',
    'changed@example.com',
    'student-missing@example.com',
  ]);
});

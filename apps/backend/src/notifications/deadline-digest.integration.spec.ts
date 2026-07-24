import {
  AccountStatus,
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
const STUDENT = 'test:notifications:student';

const STAFF_ON_GITHUB = 9_600_000_000_127_001n;
const now = new Date('2026-08-14T00:00:00.000Z');
const windowEnd = new Date('2026-08-15T00:00:00.000Z');
const dueSoon = new Date('2026-08-14T12:00:00.000Z');

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
    where: { userId: { in: [STAFF_ON, STAFF_OFF, STUDENT] } },
  });
  await prisma.milestone.deleteMany({
    where: { id: { in: [NOTIFY_MILESTONE, SILENT_MILESTONE] } },
  });
  await prisma.program.deleteMany({
    where: { id: { in: [NOTIFY_PROGRAM, SILENT_PROGRAM] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [STAFF_ON, STAFF_OFF, STUDENT] } },
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
    data: staffData(STAFF_ON, STAFF_ON_GITHUB, true, 'staff-on@jnu.ac.kr'),
  });
  await prisma.user.create({
    data: staffData(
      STAFF_OFF,
      9_600_000_000_127_002n,
      false,
      'staff-off@jnu.ac.kr',
    ),
  });
  await prisma.user.create({
    data: staffData(
      STUDENT,
      9_600_000_000_127_003n,
      true,
      'student@jnu.ac.kr',
      Role.STUDENT,
    ),
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

it('알림 켠 교직원에게만 발송하고 SENT를 기록한다(끈 교직원·학생 제외)', async () => {
  const mailSender = new RecordingMailSender();
  const service = new DeadlineDigestService(repository, mailSender);

  await service.sendDeadlineDigests(now);

  expect(mailSender.sent.map((mail) => mail.to)).toEqual([
    'staff-on@jnu.ac.kr',
  ]);
  const notifications = await prisma.notification.findMany({
    where: { userId: { in: [STAFF_ON, STAFF_OFF, STUDENT] } },
  });
  expect(notifications).toHaveLength(1);
  expect(notifications[0]).toMatchObject({
    userId: STAFF_ON,
    status: 'SENT',
    type: 'DEADLINE_DIGEST',
    channel: 'EMAIL',
  });
  expect(notifications[0]?.sentAt).not.toBeNull();
});

it('수신 이메일을 변경하면 다음 발송 대상 주소가 새 값이 된다', async () => {
  await settingsRepository.updateByGithubId(STAFF_ON_GITHUB, {
    notificationEmail: 'changed@jnu.ac.kr',
    notifyEnabled: true,
  });
  const mailSender = new RecordingMailSender();
  const service = new DeadlineDigestService(repository, mailSender);

  await service.sendDeadlineDigests(now);

  expect(mailSender.sent.map((mail) => mail.to)).toEqual([
    'changed@jnu.ac.kr',
  ]);
});

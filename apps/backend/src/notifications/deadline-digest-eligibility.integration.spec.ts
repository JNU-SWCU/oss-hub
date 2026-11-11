import { AccountStatus, ApplicationStatus } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { canonicalUserCreateFromLabel } from '../users/canonical-user-fixture';
import {
  createDeadlineDigestIntegrationHarness,
  DIGEST_FIXTURE,
  RecordingMailSender,
} from './deadline-digest.integration-support';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const harness = createDeadlineDigestIntegrationHarness();

beforeAll(() => harness.connect());
beforeEach(() => harness.reset());
afterAll(() => harness.disconnect());

it('notifyOnDeadline과 필수 서류가 있는 마감 임박 프로그램만 포함한다', async () => {
  const programIds = await harness.repository.findAutomaticProgramIds({
    from: DIGEST_FIXTURE.now,
    to: DIGEST_FIXTURE.windowEnd,
  });
  const program = await harness.repository.findDeadlineProgram(
    DIGEST_FIXTURE.notifyProgram,
  );

  expect(programIds).toEqual([DIGEST_FIXTURE.notifyProgram]);
  expect(program?.milestones[0]?.name).toBe('최종 제출');
  expect(program?.milestones[0]?.requirements).toEqual([
    expect.objectContaining({
      id: DIGEST_FIXTURE.notifyDocument,
      required: true,
    }),
  ]);
});

it('비활성 계정은 교직원 요약과 학생 리마인더 어느 쪽도 받지 않는다', async () => {
  const mailSender = new RecordingMailSender();

  await harness.service(mailSender).sendDeadlineDigests(DIGEST_FIXTURE.now);

  const recipients = mailSender.sent.map((mail) => mail.to);
  expect(recipients).not.toContain('staff-deactivated@example.com');
  expect(recipients).not.toContain('student-deactivated@example.com');
  const deactivated = await harness.prisma.user.findMany({
    where: {
      id: {
        in: [
          DIGEST_FIXTURE.staffDeactivated,
          DIGEST_FIXTURE.studentDeactivated,
        ],
      },
    },
    select: {
      accountStatus: true,
      notifyEnabled: true,
      notificationEmail: true,
    },
  });
  expect(deactivated).toHaveLength(2);
  for (const row of deactivated) {
    expect(row.accountStatus).toBe(AccountStatus.DEACTIVATED);
    expect(row.notifyEnabled).toBe(true);
    expect(row.notificationEmail).not.toBeNull();
  }
  expect(
    await harness.prisma.notification.count({
      where: {
        userId: {
          in: [
            DIGEST_FIXTURE.staffDeactivated,
            DIGEST_FIXTURE.studentDeactivated,
          ],
        },
      },
    }),
  ).toBe(0);
});

it('미제출 신청과 제외 사유를 식별자 없이 집계한다', async () => {
  const preview = await harness
    .service(new RecordingMailSender())
    .previewProgram(DIGEST_FIXTURE.notifyProgram, DIGEST_FIXTURE.now);

  expect(preview).toMatchObject({
    applicationCount: 3,
    milestoneCount: 1,
    recipientCount: 1,
    inactiveCount: 1,
    optedOutCount: 1,
    noEmailCount: 0,

    staffRecipientCount: 1,
  });
  expect(Object.keys(preview.studentPreviews[0] ?? {}).sort()).toEqual([
    'displayName',
    'html',
    'subject',
    'text',
  ]);
  expect(JSON.stringify(preview)).not.toContain('student-missing@example.com');
  expect(JSON.stringify(preview)).not.toContain(DIGEST_FIXTURE.staffOn);
});

it('아카이브된 팀 신청자는 다이제스트에서 빠지고 활성 팀 신청자는 남는다', async () => {
  const archivedUserId = 'test:notifications:student-archived';
  const archivedTeamId = 'test:notifications:application:archived';
  const archivedEmail = 'student-archived@example.com';
  await harness.prisma.user.create({
    data: {
      ...canonicalUserCreateFromLabel('STUDENT', {
        id: archivedUserId,
        githubId: 9_600_000_000_127_090n,
        nickname: 'synthetic-archived',
      }),
      notifyEnabled: true,
      notificationEmail: archivedEmail,
    },
  });
  await harness.prisma.team.create({
    data: {
      id: archivedTeamId,
      programId: DIGEST_FIXTURE.notifyProgram,
      name: 'archived-team',
      leaderId: archivedUserId,
      applicantId: archivedUserId,
      answers: {},
      applicationTemplateVersion: 1,
      status: ApplicationStatus.APPROVED,
      archivedAt: DIGEST_FIXTURE.now,
    },
  });
  try {
    const mailSender = new RecordingMailSender();
    await harness.service(mailSender).sendDeadlineDigests(DIGEST_FIXTURE.now);
    const recipients = mailSender.sent.map((mail) => mail.to);
    expect(recipients).toContain('student-missing@example.com');
    expect(recipients).not.toContain(archivedEmail);
  } finally {
    await harness.prisma.notification.deleteMany({
      where: { userId: archivedUserId },
    });
    await harness.prisma.team.deleteMany({ where: { id: archivedTeamId } });
    await harness.prisma.user.deleteMany({ where: { id: archivedUserId } });
  }
});

it('교직원 요약 수신자는 수신 동의한 활성 승인 STAFF만이다', async () => {
  const staff = await harness.repository.findNotifiableStaff();

  expect(staff.map((recipient) => recipient.id)).toEqual([
    DIGEST_FIXTURE.staffOn,
  ]);
  expect(staff.map((recipient) => recipient.notificationEmail)).toEqual([
    'staff-on@example.com',
  ]);
});

import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import {
  createDeadlineDigestIntegrationHarness,
  DIGEST_FIXTURE,
  IsolatingMailSender,
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

it('필수 서류 미제출 수신자에게만 발송하고 SENT를 기록한다', async () => {
  const mailSender = new RecordingMailSender();
  const service = harness.service(mailSender);

  await service.sendDeadlineDigests(DIGEST_FIXTURE.now);

  expect(mailSender.sent.map((mail) => mail.to).sort()).toEqual([
    'student-missing@example.com',
  ]);
  const studentMail = mailSender.sent.find(
    (mail) => mail.to === 'student-missing@example.com',
  );
  expect(studentMail?.body).toContain('최종 제출');
  expect(studentMail?.body).toContain('2026. 08. 14. 21:00 (Asia/Seoul)');
  expect(studentMail?.html).toContain(
    `https://oss.example/programs/${encodeURIComponent(DIGEST_FIXTURE.notifyProgram)}/submissions?milestoneId=${encodeURIComponent(DIGEST_FIXTURE.notifyMilestone)}`,
  );
  const notifications = await harness.prisma.notification.findMany({
    where: {
      userId: {
        in: [
          DIGEST_FIXTURE.staffOn,
          DIGEST_FIXTURE.staffOff,
          DIGEST_FIXTURE.adminOn,
          DIGEST_FIXTURE.studentMissing,
          DIGEST_FIXTURE.studentSubmitted,
          DIGEST_FIXTURE.studentOff,
          DIGEST_FIXTURE.staffDeactivated,
          DIGEST_FIXTURE.studentDeactivated,
        ],
      },
    },
    orderBy: { userId: 'asc' },
  });
  expect(notifications).toHaveLength(1);
  expect(notifications.map((row) => row.userId)).toEqual([
    DIGEST_FIXTURE.studentMissing,
  ]);
  for (const row of notifications) {
    expect(row).toMatchObject({
      status: 'SENT',
      type: 'DEADLINE_DIGEST',
      channel: 'EMAIL',
    });
    expect(row.sentAt).not.toBeNull();
  }

  await service.sendDeadlineDigests(DIGEST_FIXTURE.now);

  expect(mailSender.sent).toHaveLength(1);
  expect(
    await harness.prisma.notification.count({
      where: { type: 'DEADLINE_DIGEST' },
    }),
  ).toBe(1);
});

it('한 수신자 발송 실패가 다른 수신자의 multipart 발송과 SENT 기록을 막지 않는다', async () => {
  const mailSender = new IsolatingMailSender();

  await harness.service(mailSender).sendDeadlineDigests(DIGEST_FIXTURE.now);

  expect(mailSender.attempted).toHaveLength(1);
  for (const mail of mailSender.attempted) {
    expect(mail.body).toContain('synthetic test:notifications:program:notify');
    expect(mail.html).toContain('synthetic test:notifications:program:notify');
  }
  const ledger = await harness.prisma.notification.findMany({
    where: {
      userId: {
        in: [DIGEST_FIXTURE.studentMissing],
      },
    },
    select: { userId: true, status: true, payload: true },
    orderBy: { userId: 'asc' },
  });
  expect(ledger).toEqual([
    {
      userId: DIGEST_FIXTURE.studentMissing,
      status: 'FAILED',
      payload: {
        milestoneCount: 1,
        code: 'MAIL_DELIVERY_FAILED',
        message: '메일 발송에 실패했습니다.',
      },
    },
  ]);
  expect(JSON.stringify(ledger)).not.toContain('leaked-recipient');
  expect(JSON.stringify(ledger)).not.toContain('synthetic-provider-token');
});

it('교직원 수동 발송만 미제출 팀 목록 요약을 함께 보낸다', async () => {
  const automatic = new RecordingMailSender();
  await harness.service(automatic).sendDeadlineDigests(DIGEST_FIXTURE.now);

  // 자동(09시 cron) 경로에는 교직원 요약이 없다.
  expect(automatic.sent.map((mail) => mail.to)).toEqual([
    'student-missing@example.com',
  ]);

  await harness.reset();
  const manual = new RecordingMailSender();
  const service = harness.service(manual);
  const preview = await service.previewProgram(
    DIGEST_FIXTURE.staffOnGithub,
    DIGEST_FIXTURE.notifyProgram,
    DIGEST_FIXTURE.now,
  );

  const result = await service.sendProgramFromPreview(
    DIGEST_FIXTURE.staffOnGithub,
    DIGEST_FIXTURE.notifyProgram,
    preview,
    DIGEST_FIXTURE.now,
  );

  expect(result).toMatchObject({ sentCount: 1, staffRecipientCount: 2 });
  expect(manual.sent.map((mail) => mail.to).sort()).toEqual([
    'admin-on@example.com',
    'staff-on@example.com',
    'student-missing@example.com',
  ]);
  const staffMail = manual.sent.find(
    (mail) => mail.to === 'staff-on@example.com',
  );
  for (const content of [staffMail?.body, staffMail?.html]) {
    expect(content).toContain(`synthetic-${DIGEST_FIXTURE.studentMissing}`);
    expect(content).toContain(
      `synthetic-${DIGEST_FIXTURE.studentOff} (수신 거부)`,
    );
    expect(content).toContain(
      `synthetic-${DIGEST_FIXTURE.studentDeactivated} (비활성)`,
    );
  }
  expect(staffMail?.html).toContain('https://oss.example/staff/dashboard');

  const ledger = await harness.prisma.notification.findMany({
    where: { type: 'DEADLINE_DIGEST' },
    select: { userId: true, idempotencyKey: true, status: true },
  });
  expect(ledger.map((row) => row.idempotencyKey).sort()).toEqual([
    `deadline-digest-staff:2026-08-14:${DIGEST_FIXTURE.notifyProgram}:${DIGEST_FIXTURE.adminOn}`,
    `deadline-digest-staff:2026-08-14:${DIGEST_FIXTURE.notifyProgram}:${DIGEST_FIXTURE.staffOn}`,
    `deadline-digest:2026-08-14:${DIGEST_FIXTURE.notifyProgram}:${DIGEST_FIXTURE.studentMissing}`,
  ]);
  expect(ledger.every((row) => row.status === 'SENT')).toBe(true);

  // 같은 날 두 번째 수동 발송은 학생·교직원 양쪽 모두 멱등하게 막힌다.
  await service.sendProgramFromPreview(
    DIGEST_FIXTURE.staffOnGithub,
    DIGEST_FIXTURE.notifyProgram,
    preview,
    DIGEST_FIXTURE.now,
  );

  expect(manual.sent).toHaveLength(3);
});

it('수신 이메일을 변경하면 다음 발송 대상 주소가 새 값이 된다', async () => {
  await harness.settingsRepository.updateByGithubId(
    DIGEST_FIXTURE.studentMissingGithub,
    {
      notificationEmail: 'changed@example.com',
      notifyEnabled: true,
    },
  );
  const mailSender = new RecordingMailSender();

  await harness.service(mailSender).sendDeadlineDigests(DIGEST_FIXTURE.now);

  expect(mailSender.sent.map((mail) => mail.to).sort()).toEqual([
    'changed@example.com',
  ]);
});

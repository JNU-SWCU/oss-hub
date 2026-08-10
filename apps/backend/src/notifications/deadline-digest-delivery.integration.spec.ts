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

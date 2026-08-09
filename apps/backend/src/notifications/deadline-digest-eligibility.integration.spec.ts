import { AccountStatus } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
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

it('notifyOnDeadline 프로그램의 마감 임박 마일스톤만 포함한다', async () => {
  const milestones = await harness.repository.findUpcomingDeadlineMilestones(
    DIGEST_FIXTURE.now,
    DIGEST_FIXTURE.windowEnd,
  );
  expect(milestones).toHaveLength(1);
  expect(milestones[0]?.milestoneName).toBe('최종 제출');
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

it('비활성 학생도 교직원 요약의 미제출자 집계에는 남고 비활성 표시가 붙는다', async () => {
  const mailSender = new RecordingMailSender();

  await harness.service(mailSender).sendDeadlineDigests(DIGEST_FIXTURE.now);

  const staffMail = mailSender.sent.find(
    (mail) => mail.to === 'staff-on@example.com',
  );
  expect(staffMail?.body).toContain(
    'synthetic-test:notifications:student-deactivated',
  );
  expect(staffMail?.html).toContain(
    'synthetic-test:notifications:student-deactivated (비활성)',
  );
  expect(staffMail?.body).toContain(
    'synthetic-test:notifications:student-deactivated (비활성)',
  );
  expect(staffMail?.body).not.toContain(
    'synthetic-test:notifications:student-missing (비활성)',
  );
  expect(staffMail?.body).not.toContain(
    'synthetic-test:notifications:student-off (비활성)',
  );
});

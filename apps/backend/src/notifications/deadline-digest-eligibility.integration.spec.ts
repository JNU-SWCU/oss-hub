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
  expect(program?.milestones[0]?.documents).toEqual([
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
    .previewProgram(
      DIGEST_FIXTURE.staffOnGithub,
      DIGEST_FIXTURE.notifyProgram,
      DIGEST_FIXTURE.now,
    );

  expect(preview).toMatchObject({
    applicationCount: 3,
    milestoneCount: 1,
    recipientCount: 1,
    inactiveCount: 1,
    optedOutCount: 1,
    noEmailCount: 0,
  });
  expect(JSON.stringify(preview)).not.toContain(DIGEST_FIXTURE.studentMissing);
});

import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import {
  createDeadlineDigestIntegrationHarness,
  DIGEST_FIXTURE,
  RecordingMailSender,
} from './deadline-digest.integration-support';
import { DeadlineDigestTriggerService } from './deadline-digest-trigger.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const harness = createDeadlineDigestIntegrationHarness();

beforeAll(() => harness.connect());
beforeEach(() => harness.reset());
afterAll(() => harness.disconnect());

it('교직원 수동 트리거가 같은 배치를 실행하고 학생 HTML을 남긴다', async () => {
  const mailSender = new RecordingMailSender();
  const digestService = harness.service(mailSender);
  const trigger = new DeadlineDigestTriggerService(
    harness.repository,
    digestService,
  );

  await trigger.triggerSend(DIGEST_FIXTURE.staffOnGithub, DIGEST_FIXTURE.now);

  expect(mailSender.sent.map((mail) => mail.to).sort()).toEqual([
    'student-missing@example.com',
  ]);
  const studentMail = mailSender.sent.find(
    (mail) => mail.to === 'student-missing@example.com',
  );
  expect(studentMail?.html).toContain('제출 마감');
  expect(studentMail?.html).toContain('마감 정보');
});

it('학생이 수동 트리거를 호출하면 STAFF_ONLY로 거부되고 메일을 보내지 않는다', async () => {
  const mailSender = new RecordingMailSender();
  const digestService = harness.service(mailSender);
  const trigger = new DeadlineDigestTriggerService(
    harness.repository,
    digestService,
  );

  await expect(
    trigger.triggerSend(DIGEST_FIXTURE.studentMissingGithub, DIGEST_FIXTURE.now),
  ).rejects.toMatchObject({
    errorCode: { code: 'NOT_001', status: 403 },
  });
  expect(mailSender.sent).toHaveLength(0);
});

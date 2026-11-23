import { createOwnedIntegrationDatabase } from '../../test/owned-integration-database.fixture';
import {
  createDeadlineDigestIntegrationHarness,
  DIGEST_FIXTURE,
  RecordingMailSender,
} from './deadline-digest.integration-support';
import { DIGEST_USER_IDS } from './deadline-digest.integration-fixtures';

let database: Awaited<ReturnType<typeof createOwnedIntegrationDatabase>>;
let harness: ReturnType<typeof createDeadlineDigestIntegrationHarness>;

beforeEach(async () => {
  database = await createOwnedIntegrationDatabase();
  harness = createDeadlineDigestIntegrationHarness(database.prisma);
  await harness.reset();
}, 90_000);
afterEach(async () => {
  await database?.close();
}, 30_000);

it.each([0, 1])(
  'refuses a paused confirmation with %i student recipients before any audit or delivery',
  async (recipients) => {
    if (recipients === 0) {
      await database.prisma.user.updateMany({
        where: { id: { in: DIGEST_USER_IDS } },
        data: { notifyEnabled: false },
      });
    }
    const sender = new RecordingMailSender();
    const service = harness.service(sender);
    const preview = await service.previewProgram(
      DIGEST_FIXTURE.notifyProgram,
      DIGEST_FIXTURE.now,
    );
    expect(preview.recipientCount).toBe(recipients);
    await database.prisma.mailControl.update({
      where: { id: 1 },
      data: { mode: 'PAUSED' },
    });
    await expect(
      service.sendProgramFromPreview(
        DIGEST_FIXTURE.notifyProgram,
        preview,
        DIGEST_FIXTURE.staffOn,
        DIGEST_FIXTURE.now,
      ),
    ).rejects.toMatchObject({ errorCode: { code: 'NOT_012', status: 503 } });
    expect(sender.sent).toHaveLength(0);
    expect(
      await database.prisma.programHistory.count({
        where: { sourceTable: 'MailJob' },
      }),
    ).toBe(0);
  },
  30_000,
);

it('holds unclaimed mail while paused, cancels withdrawn consent on resume, and records one result', async () => {
  await harness.useJobs();
  const sender = new RecordingMailSender();
  const runtime = harness.service({
    async send(mail) {
      await sender.send(mail);
      await database.prisma.mailControl.update({
        where: { id: 1 },
        data: { mode: 'PAUSED' },
      });
    },
  });
  const id = DIGEST_FIXTURE.notifyProgram;
  const preview = await runtime.previewProgram(id, DIGEST_FIXTURE.now);
  expect([preview.recipientCount, preview.staffRecipientCount]).toEqual([1, 1]);
  const { jobId } = await runtime.accept(
    id,
    preview,
    DIGEST_FIXTURE.staffOn,
    true,
  );
  expect(await runtime.worker.step()).toBe(true);
  expect(await runtime.worker.step()).toBe(false);
  expect(sender.sent).toHaveLength(1);
  const pending = await database.prisma.mailRecipient.findFirstOrThrow({
    where: { jobId, state: 'PENDING' },
    select: { userId: true },
  });
  const history = () =>
    database.prisma.programHistory.findMany({
      where: { sourceTable: 'MailJob', programId: id },
      orderBy: { event: 'asc' },
      select: { event: true, data: true },
      take: 3,
    });
  expect((await history()).map((h) => h.event)).toEqual(['MAIL_ACCEPTED']);
  await database.prisma.user.update({
    where: { id: pending.userId },
    data: { notifyEnabled: false },
  });
  await database.prisma.mailControl.update({
    where: { id: 1 },
    data: { mode: 'JOBS' },
  });
  await runtime.drain();
  expect(sender.sent).toHaveLength(1);
  const events = await history();
  expect(events.map((h) => h.event)).toEqual([
    'MAIL_ACCEPTED',
    'MAIL_COMPLETED',
  ]);
  expect(events[1]?.data).toMatchObject({
    metadata: {
      sentCount: 1,
      failedCount: 0,
      duplicateCount: 0,
      cancelledCount: 1,
    },
  });
}, 30000);

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
      await database.prisma.userHistory.count({
        where: { sourceTable: 'DeadlineDigest' },
      }),
    ).toBe(0);
  },
  30_000,
);

it('records one result and stops unclaimed staff mail when paused after student delivery', async () => {
  const sender = new RecordingMailSender();
  const service = harness.service({
    async send(mail) {
      await sender.send(mail);
      await database.prisma.mailControl.update({
        where: { id: 1 },
        data: { mode: 'PAUSED' },
      });
    },
  });
  const preview = await service.previewProgram(
    DIGEST_FIXTURE.notifyProgram,
    DIGEST_FIXTURE.now,
  );
  expect(preview.staffRecipientCount).toBe(1);
  await expect(
    service.sendProgramFromPreview(
      DIGEST_FIXTURE.notifyProgram,
      preview,
      DIGEST_FIXTURE.staffOn,
      DIGEST_FIXTURE.now,
    ),
  ).rejects.toMatchObject({ errorCode: { code: 'NOT_012' } });
  expect(sender.sent).toHaveLength(1);
  const history = await database.prisma.userHistory.findMany({
    where: { sourceTable: 'DeadlineDigest' },
    orderBy: { sourcePart: 'asc' },
    take: 3,
    select: { sourcePart: true, data: true },
  });
  expect(history.map((event) => event.sourcePart)).toEqual([
    'attempt',
    'result',
  ]);
  expect(history[1]?.data).toMatchObject({
    metadata: {
      sentCount: 1,
      failedCount: 0,
      duplicateCount: 0,
      cancelledCount: 1,
    },
  });
}, 30_000);

import { createOwnedIntegrationDatabase } from '../../test/owned-integration-database.fixture';
import { ProgramMailJobRepository } from './program-mail-job.repository';
import { ProgramMailBatchPayloadRepository } from './program-mail-batch-payload.repository';
import { ProgramDeletionScopeRepository } from '../programs/programs.repository';
import { Prisma } from '@prisma/client';
import { AUDIT_SOURCE_QUERIES } from '../platform/audit-source.config';
import { ProgramMailAuditRepository } from './program-mail-audit.repository';
import { ProgramMailBatchRepository } from './program-mail-batch.repository';
import { ProgramMailDeliveryRepository } from './program-mail-delivery.repository';
import { ProgramMailKeyRepository } from './program-mail-key.repository';
import { ProgramMailSendRepository } from './program-mail-send.repository';
import { SystemStatusRepository } from '../admin/system-status.repository';
import { PlatformRepository } from '../platform/platform.repository';

const SETUP_TIMEOUT_MS = 90_000;
const BODY_TIMEOUT_MS = 30_000;
const CREATED = new Date('2026-11-22T00:00:00.000Z');
let database: Awaited<ReturnType<typeof createOwnedIntegrationDatabase>>;
const programId = 'synthetic-mail-bridge';
const userId = 'synthetic-mail-bridge-user';
const otherUserId = 'synthetic-mail-bridge-other';

beforeEach(async () => {
  database = await createOwnedIntegrationDatabase();
  await database.prisma.user.create({
    data: {
      id: userId,
      githubId: 987654321234n,
      nickname: 'synthetic-mail-bridge',
    },
  });
  await database.prisma.user.create({
    data: {
      id: otherUserId,
      githubId: 987654321235n,
      nickname: 'synthetic-mail-bridge-other',
    },
  });
  await database.prisma.program.create({
    data: {
      id: programId,
      name: 'Synthetic mail bridge',
      category: 'BASIC',
      applicationTemplateKey: 'synthetic',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2026-11-20T00:00:00.000Z'),
      applicationEndAt: new Date('2026-11-21T00:00:00.000Z'),
      startAt: CREATED,
      endAt: new Date('2026-11-24T00:00:00.000Z'),
      description: '',
    },
  });
}, SETUP_TIMEOUT_MS);
afterEach(async () => {
  await database?.close();
});

describe('when legacy finishes work after an unfinished paused import', () => {
  let jobId: string;
  const payloads = new ProgramMailBatchPayloadRepository();
  const refresh = () =>
    database.prisma.$queryRaw`SELECT import_legacy_program_mail(${jobId})`;

  beforeEach(async () => {
    const prisma = database.prisma;
    const audit = new ProgramMailAuditRepository();
    const keys = new ProgramMailKeyRepository();
    const sender = new ProgramMailSendRepository(prisma, audit, keys, payloads);
    const batches = new ProgramMailBatchRepository(prisma, audit, payloads);
    const deliveries = new ProgramMailDeliveryRepository(prisma, keys);
    await prisma.program.update({
      where: { id: programId },
      data: { lifecycle: 'PUBLISHED' },
    });
    const reservation = await sender.reserve({
      actorId: userId,
      programId,
      programName: 'Synthetic',
      senderName: 'Synthetic',
      subject: 'Synthetic',
      body: 'Body',
      bodyLength: 4,
      bodyHash: 'synthetic',
      previewVersion: 'synthetic-rollback',
      occurredAt: CREATED,
      recipients: [
        {
          id: otherUserId,
          displayName: 'Synthetic',
          notificationEmail: 'rollback@example.invalid',
        },
      ],
    });
    jobId = reservation.jobId;
    await prisma.mailControl.update({
      where: { id: 1 },
      data: { mode: 'PAUSED' },
    });
    await refresh();
    const receipts = new ProgramMailJobRepository(prisma, payloads);
    await expect(receipts.status(programId, jobId)).resolves.toMatchObject({
      jobId,
      status: 'QUEUED',
    });
    await prisma.mailControl.update({
      where: { id: 1 },
      data: { mode: 'LEGACY' },
    });
    const work = await batches.claim(
      reservation.batchKey,
      'synthetic-worker',
      CREATED,
    );
    if ('kind' in work)
      throw new Error(
        'Expected the original legacy reservation to be claimable',
      );
    const [recipient] = await deliveries.states(work);
    if (!recipient) throw new Error('Expected the reserved legacy recipient');
    expect(await deliveries.claim(work, recipient, CREATED)).toBe(true);
    expect(
      await deliveries.complete({
        work,
        state: recipient,
        status: 'FAILED',
        now: CREATED,
      }),
    ).toBe(true);
    const result = await deliveries.result(work);
    if (!result) throw new Error('Expected a terminal delivery result');
    await expect(
      batches.complete(work, result, CREATED),
    ).resolves.toMatchObject({ kind: 'COMPLETED', result: { failedCount: 1 } });
  }, BODY_TIMEOUT_MS);

  it('keeps the original completed receipt visible before and after re-import', async () => {
    const prisma = database.prisma;
    const receipts = new ProgramMailJobRepository(prisma, payloads);
    const check = async () => {
      await expect(receipts.status(programId, jobId)).resolves.toMatchObject({
        jobId,
        status: 'COMPLETED',
        failedCount: 1,
      });
      expect(
        (await receipts.recent(programId)).items.map((row) => row.jobId),
      ).toEqual([jobId]);
    };
    await check();
    await prisma.mailControl.update({
      where: { id: 1 },
      data: { mode: 'PAUSED' },
    });
    await refresh();
    await refresh();
    expect(
      await prisma.mailJob.findUniqueOrThrow({
        where: { id: jobId },
        select: { state: true, recipients: { select: { state: true } } },
      }),
    ).toEqual({ state: 'COMPLETED', recipients: [{ state: 'FAILED' }] });
    await check();
    expect(
      await prisma.userHistory.count({ where: { sourceTable: 'ProgramMail' } }),
    ).toBe(2);
  });

  it('counts the confirmed legacy failure once before and after re-import', async () => {
    const prisma = database.prisma;
    const status = new SystemStatusRepository(prisma, new PlatformRepository());
    const expected = { sent7d: 0, failed7d: 1, unknown7d: 0, lastSentAt: null };
    await expect(status.getMailStatus(new Date(0))).resolves.toEqual(expected);
    await prisma.mailControl.update({
      where: { id: 1 },
      data: { mode: 'PAUSED' },
    });
    await refresh();
    await expect(status.getMailStatus(new Date(0))).resolves.toEqual(expected);
  });
});

it(
  'projects new program mail history with the existing action and count contract',
  async () => {
    const prisma = database.prisma;
    await prisma.programHistory.createMany({
      data: [
        {
          id: 'synthetic-accepted',
          programId,
          actorId: userId,
          event: 'MAIL_ACCEPTED',
          source: 'APPLICATION',
          sourceTable: 'MailJob',
          sourceId: 'synthetic-receipt:attempt',
          data: {
            schemaVersion: 1,
            action: 'PROGRAM_MAIL_SEND_ATTEMPTED',
            metadata: { recipientCount: 2 },
          },
        },
        {
          id: 'synthetic-completed',
          programId,
          actorId: userId,
          event: 'MAIL_COMPLETED',
          source: 'APPLICATION',
          sourceTable: 'MailJob',
          sourceId: 'synthetic-receipt:result',
          data: {
            schemaVersion: 1,
            action: 'PROGRAM_MAIL_DELIVERY_UNKNOWN',
            metadata: {
              sentCount: 1,
              failedCount: 0,
              unknownCount: 1,
              duplicateCount: 0,
            },
          },
        },
      ],
    });
    const records = await prisma.$queryRaw<
      { action: string; actorId: string; metadata: Prisma.JsonValue }[]
    >(Prisma.sql`
      SELECT action, "actorId", metadata FROM (${Prisma.raw(AUDIT_SOURCE_QUERIES.PROGRAM)}) source
      WHERE "programId" = ${programId} ORDER BY id LIMIT 3
    `);
    expect(records).toEqual([
      {
        action: 'PROGRAM_MAIL_SEND_ATTEMPTED',
        actorId: userId,
        metadata: { recipientCount: 2 },
      },
      {
        action: 'PROGRAM_MAIL_DELIVERY_UNKNOWN',
        actorId: userId,
        metadata: {
          sentCount: 1,
          failedCount: 0,
          unknownCount: 1,
          duplicateCount: 0,
        },
      },
    ]);
  },
  BODY_TIMEOUT_MS,
);

async function seedTerminalReceipt(
  members: readonly string[],
  attemptMembers: readonly string[],
  resultMembers: readonly string[],
) {
  const prisma = database.prisma;
  const result = {
    sentCount: 1,
    failedCount: 0,
    unknownCount: members.length - 1,
    duplicateCount: 0,
  };
  await prisma.notification.createMany({
    data: [
      {
        id: 'synthetic-batch',
        userId,
        type: 'PROGRAM_MAIL_SEND',
        channel: 'INTERNAL',
        status: 'COMPLETED',
        idempotencyKey: 'program-mail-send:synthetic',
        payload: {
          schemaVersion: 1,
          programId,
          previewVersion: 'synthetic',
          result,
        },
        createdAt: CREATED,
        sentAt: CREATED,
      },
      ...members.map((id, index) => ({
        id: `synthetic-delivery-${index}`,
        userId: id,
        type: 'PROGRAM_MAIL',
        channel: 'EMAIL',
        status: index === 0 ? 'SENT' : 'FAILED',
        idempotencyKey: `program-mail:synthetic:${id}`,
        payload: {
          schemaVersion: 1,
          batchKey: 'program-mail-send:synthetic',
          ...(index === 0 ? {} : { code: 'MAIL_DELIVERY_UNKNOWN' }),
        },
        sentAt: index === 0 ? CREATED : null,
      })),
    ],
  });
  const audit = new ProgramMailAuditRepository();
  const content = {
    actorId: userId,
    programId,
    programName: 'Synthetic mail bridge',
    senderName: 'Synthetic sender',
    subject: 'Synthetic subject',
    body: 'Synthetic body',
    bodyHash: 'synthetic-hash',
    bodyLength: 14,
    previewVersion: 'synthetic',
    occurredAt: CREATED,
  };
  const recipients = (ids: readonly string[]) =>
    ids.map((id) => ({
      id,
      displayName: id,
      notificationEmail: `${id}@example.invalid`,
    }));
  await audit.recordAttempt(
    {
      input: { ...content, recipients: recipients(attemptMembers) },
      batchKey: 'program-mail-send:synthetic',
    },
    prisma,
  );
  await audit.recordResult(
    {
      input: { ...content, recipients: recipients(resultMembers) },
      batchKey: 'program-mail-send:synthetic',
      result,
      occurredAt: CREATED,
    },
    prisma,
  );
  return result;
}

it.each([
  { phase: 'attempt', attempt: [otherUserId], result: [userId] },
  { phase: 'result', attempt: [userId], result: [otherUserId] },
  {
    phase: 'expanded result',
    attempt: [userId],
    result: [userId, otherUserId],
  },
  { phase: 'duplicated result', attempt: [userId], result: [userId, userId] },
])(
  'quarantines a receipt when its $phase roster differs from the delivery rows',
  async ({ attempt, result }) => {
    const prisma = database.prisma;
    await seedTerminalReceipt([userId], attempt, result);
    await prisma.mailControl.update({
      where: { id: 1 },
      data: { mode: 'PAUSED' },
    });
    await prisma.$queryRaw`SELECT import_legacy_program_mail('synthetic-batch')`;
    expect(
      await prisma.mailJob.findUniqueOrThrow({
        where: { id: 'synthetic-batch' },
        select: {
          state: true,
          partFinishedAt: true,
          receiptFinishedAt: true,
          result: true,
        },
      }),
    ).toEqual({
      state: 'QUARANTINED',
      partFinishedAt: null,
      receiptFinishedAt: null,
      result: null,
    });
    const reader = new ProgramMailJobRepository(
      prisma,
      new ProgramMailBatchPayloadRepository(),
    );
    await expect(reader.status(programId, 'synthetic-batch')).rejects.toThrow();
    expect((await reader.recent(programId)).items).toEqual([]);
  },
  BODY_TIMEOUT_MS,
);

it(
  'rejects string versions and counts even when their numeric values reconcile',
  async () => {
    const prisma = database.prisma;
    const result = await seedTerminalReceipt([userId], [userId], [userId]);
    const payload = {
      schemaVersion: 1,
      programId,
      previewVersion: 'synthetic',
      result,
    };
    await prisma.mailControl.update({
      where: { id: 1 },
      data: { mode: 'PAUSED' },
    });
    for (const malformed of [
      { ...payload, schemaVersion: '1' },
      ...Object.entries(result).map(([field, value]) => ({
        ...payload,
        result: { ...result, [field]: String(value) },
      })),
    ]) {
      await prisma.notification.update({
        where: { id: 'synthetic-batch' },
        data: { payload: malformed },
      });
      await expect(
        prisma.$queryRaw`SELECT import_legacy_program_mail('synthetic-batch')`,
      ).rejects.toMatchObject({
        code: 'P2010',
        meta: { driverAdapterError: { cause: { originalCode: '22023' } } },
      });
      expect(await prisma.mailJob.count()).toBe(0);
    }
  },
  BODY_TIMEOUT_MS,
);

it(
  'imports a mixed terminal receipt twice without changing identities, audits or totals',
  async () => {
    const prisma = database.prisma;
    const members = [userId, otherUserId];
    await seedTerminalReceipt(members, members, [...members].reverse());
    const reader = new ProgramMailJobRepository(
      prisma,
      new ProgramMailBatchPayloadRepository(),
    );
    const before = await reader.status(programId, 'synthetic-batch');
    const scopes = new ProgramDeletionScopeRepository();
    const scopeBefore = await scopes.readProgramDeletionScopeCounts(
      prisma,
      programId,
    );
    await expect(
      prisma.$queryRaw`SELECT import_legacy_program_mail('synthetic-batch')`,
    ).rejects.toThrow();
    await prisma.mailControl.update({
      where: { id: 1 },
      data: { mode: 'PAUSED' },
    });
    await prisma.$queryRaw`SELECT import_legacy_program_mail('synthetic-batch')`;
    const imported = await prisma.mailJob.findUniqueOrThrow({
      where: { id: 'synthetic-batch' },
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
        result: true,
        receiptFinishedAt: true,
      },
    });
    await prisma.$queryRaw`SELECT import_legacy_program_mail('synthetic-batch')`;
    expect(
      await prisma.mailJob.findUniqueOrThrow({
        where: { id: 'synthetic-batch' },
        select: {
          id: true,
          createdAt: true,
          updatedAt: true,
          result: true,
          receiptFinishedAt: true,
        },
      }),
    ).toEqual(imported);
    expect(await prisma.mailJob.count()).toBe(1);
    expect(await prisma.mailRecipient.count()).toBe(2);
    expect(await prisma.programHistory.count()).toBe(0);
    expect(
      await prisma.userHistory.count({ where: { sourceTable: 'ProgramMail' } }),
    ).toBe(2);
    expect(await reader.status(programId, 'synthetic-batch')).toEqual(before);
    expect(
      (await reader.recent(programId)).items.map((row) => row.jobId),
    ).toEqual(['synthetic-batch']);
    expect(
      (await scopes.readProgramDeletionScopeCounts(prisma, programId))
        .scopeFingerprint,
    ).not.toBe(scopeBefore.scopeFingerprint);
    expect(
      await prisma.mailRecipient.findMany({
        take: 3,
        orderBy: { id: 'asc' },
        select: { state: true, envelope: true },
      }),
    ).toEqual([
      { state: 'SENT', envelope: null },
      { state: 'UNKNOWN', envelope: null },
    ]);
    await prisma.notification.deleteMany({ where: { id: 'synthetic-batch' } });
    expect(await reader.status(programId, 'synthetic-batch')).toEqual(before);
    expect(
      (await reader.recent(programId)).items.map((row) => row.jobId),
    ).toEqual(['synthetic-batch']);
    await expect(
      reader.status('synthetic-wrong-program', 'synthetic-batch'),
    ).rejects.toThrow();
    const status = new SystemStatusRepository(prisma, new PlatformRepository());
    expect(await status.getMailStatus(CREATED)).toEqual({
      sent7d: 1,
      failed7d: 0,
      unknown7d: 1,
      lastSentAt: CREATED,
    });
    await prisma.mailJob.create({
      data: {
        id: 'synthetic-typed',
        receiptId: 'synthetic-typed',
        partNo: 0,
        source: 'DEADLINE_MANUAL',
        programId,
        actorId: userId,
        seoulDay: CREATED,
        state: 'QUARANTINED',
      },
    });
    const later = new Date(CREATED.getTime() + 3_600_000);
    await prisma.mailRecipient.createMany({
      data: [
        {
          jobId: 'synthetic-typed',
          ordinal: 0,
          audience: 'STAFF',
          userId,
          deliveryKey: 'synthetic-typed-sent',
          state: 'SENT',
          finishedAt: later,
        },
        {
          jobId: 'synthetic-typed',
          ordinal: 1,
          audience: 'STAFF',
          userId: otherUserId,
          deliveryKey: 'synthetic-typed-unknown',
          state: 'UNKNOWN',
        },
      ],
    });
    expect(await status.getMailStatus(CREATED)).toEqual({
      sent7d: 2,
      failed7d: 0,
      unknown7d: 2,
      lastSentAt: later,
    });
  },
  BODY_TIMEOUT_MS,
);

it(
  'paused storage blocks every legacy admission while preserving completed reads',
  async () => {
    const prisma = database.prisma;
    await prisma.notification.createMany({
      data: [
        {
          id: 'synthetic-unclaimed',
          userId,
          type: 'PROGRAM_MAIL',
          channel: 'EMAIL',
          status: 'PENDING',
          payload: {},
        },
        {
          id: 'synthetic-inflight',
          userId,
          type: 'PROGRAM_MAIL',
          channel: 'EMAIL',
          status: 'PROCESSING',
          payload: { leaseToken: 'synthetic-owner' },
        },
      ],
    });
    await prisma.mailControl.update({
      where: { id: 1 },
      data: { mode: 'PAUSED' },
    });
    const writes = ['PROGRAM_MAIL_SEND', 'PROGRAM_MAIL', 'DEADLINE_DIGEST'].map(
      (type) =>
        prisma.notification.create({
          data: {
            userId,
            type,
            channel: type === 'PROGRAM_MAIL_SEND' ? 'INTERNAL' : 'EMAIL',
            status: 'PENDING',
            payload: {},
          },
        }),
    );
    const results = await Promise.allSettled(writes);
    expect(results.map((row) => row.status)).toEqual([
      'rejected',
      'rejected',
      'rejected',
    ]);
    await expect(
      prisma.notification.update({
        where: { id: 'synthetic-unclaimed' },
        data: { status: 'PROCESSING' },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.notification.update({
        where: { id: 'synthetic-inflight' },
        data: { status: 'SENT' },
      }),
    ).resolves.toMatchObject({ status: 'SENT' });
    await expect(
      prisma.mailControl.update({ where: { id: 1 }, data: { mode: 'JOBS' } }),
    ).rejects.toThrow();
    await prisma.mailControl.update({
      where: { id: 1 },
      data: { mode: 'LEGACY' },
    });
    await expect(
      prisma.notification.create({
        data: {
          userId,
          type: 'DEADLINE_DIGEST',
          channel: 'EMAIL',
          status: 'PENDING',
          idempotencyKey: 'deadline-digest:2026-11-22:synthetic:student',
          payload: {},
        },
      }),
    ).resolves.toMatchObject({ status: 'PENDING' });
  },
  BODY_TIMEOUT_MS,
);

it(
  'rejects a completed legacy receipt without matching attempt and result history',
  async () => {
    const prisma = database.prisma;
    await prisma.notification.createMany({
      data: [
        {
          id: 'synthetic-no-audit',
          userId,
          type: 'PROGRAM_MAIL_SEND',
          channel: 'INTERNAL',
          status: 'COMPLETED',
          idempotencyKey: 'program-mail-send:no-audit',
          sentAt: CREATED,
          payload: {
            schemaVersion: 1,
            programId,
            previewVersion: 'no-audit',
            result: {
              sentCount: 1,
              failedCount: 0,
              unknownCount: 0,
              duplicateCount: 0,
            },
          },
        },
        {
          id: 'synthetic-no-audit-recipient',
          userId,
          type: 'PROGRAM_MAIL',
          channel: 'EMAIL',
          status: 'SENT',
          idempotencyKey: 'program-mail:no-audit:recipient',
          sentAt: CREATED,
          payload: { schemaVersion: 1, batchKey: 'program-mail-send:no-audit' },
        },
      ],
    });
    await prisma.mailControl.update({
      where: { id: 1 },
      data: { mode: 'PAUSED' },
    });
    await expect(
      prisma.$queryRaw`SELECT import_legacy_program_mail('synthetic-no-audit')`,
    ).rejects.toMatchObject({
      code: 'P2010',
      meta: { driverAdapterError: { cause: { originalCode: '22023' } } },
    });
    expect(await prisma.mailJob.count()).toBe(0);
  },
  BODY_TIMEOUT_MS,
);

it(
  'system status counts owning typed rows once and keeps unknown distinct from failure',
  async () => {
    const prisma = database.prisma;
    await prisma.notification.createMany({
      data: [
        {
          id: 'synthetic-shadow',
          userId: otherUserId,
          type: 'PROGRAM_MAIL',
          channel: 'EMAIL',
          status: 'FAILED',
          idempotencyKey: 'synthetic-shadow-key',
          payload: {},
          createdAt: CREATED,
        },
        {
          userId,
          type: 'PROGRAM_MAIL',
          channel: 'EMAIL',
          status: 'FAILED',
          payload: { batchKey: 'synthetic-status-batch' },
        },
        {
          userId,
          type: 'DEADLINE_DIGEST',
          channel: 'EMAIL',
          status: 'FAILED',
          payload: {},
        },
      ],
    });
    await prisma.mailJob.create({
      data: {
        id: 'synthetic-typed-status',
        receiptId: 'synthetic-typed-status',
        intentKey: 'synthetic-status-batch',
        partNo: 0,
        source: 'PROGRAM_MANUAL',
        programId,
        actorId: userId,
        seoulDay: CREATED,
        state: 'COMPLETED',
      },
    });
    await prisma.mailRecipient.createMany({
      data: [
        {
          id: 'synthetic-shadow',
          jobId: 'synthetic-typed-status',
          ordinal: 0,
          audience: 'STUDENT',
          userId: otherUserId,
          deliveryKey: 'synthetic-shadow-key',
          state: 'UNKNOWN',
        },
        {
          jobId: 'synthetic-typed-status',
          ordinal: 1,
          audience: 'STUDENT',
          userId,
          deliveryKey: 'synthetic-new-sent',
          state: 'SENT',
          finishedAt: CREATED,
        },
        {
          jobId: 'synthetic-typed-status',
          ordinal: 2,
          audience: 'STAFF',
          userId: otherUserId,
          deliveryKey: 'synthetic-new-failed',
          state: 'FAILED',
        },
        {
          jobId: 'synthetic-typed-status',
          ordinal: 3,
          audience: 'STAFF',
          userId,
          deliveryKey: 'synthetic-other-failed',
          state: 'FAILED',
        },
      ],
    });
    expect(
      await new SystemStatusRepository(
        prisma,
        new PlatformRepository(),
      ).getMailStatus(new Date(0)),
    ).toEqual({ sent7d: 1, failed7d: 3, unknown7d: 1, lastSentAt: CREATED });
  },
  BODY_TIMEOUT_MS,
);

it(
  'the database enforces recipient ordinals, delivery-key ownership and terminal privacy',
  async () => {
    const prisma = database.prisma;
    await prisma.mailJob.create({
      data: {
        id: 'synthetic-batch',
        receiptId: 'synthetic-batch',
        partNo: 0,
        source: 'PROGRAM_MANUAL',
        programId,
        actorId: userId,
        seoulDay: CREATED,
        state: 'QUARANTINED',
      },
    });
    await prisma.mailRecipient.create({
      data: {
        jobId: 'synthetic-batch',
        ordinal: 0,
        audience: 'STUDENT',
        userId,
        state: 'SENT',
        deliveryKey: 'program-mail:synthetic:sent',
      },
    });
    const row = {
      jobId: 'synthetic-batch',
      ordinal: 200,
      audience: 'STUDENT' as const,
      userId,
      state: 'PENDING' as const,
    };
    await expect(prisma.mailRecipient.create({ data: row })).rejects.toThrow();
    await expect(
      prisma.mailRecipient.create({
        data: {
          ...row,
          ordinal: 9,
          deliveryKey: 'program-mail:synthetic:sent',
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.mailRecipient.create({
        data: { ...row, ordinal: 10, deliveryKey: 'synthetic-other-key' },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.mailRecipient.create({
        data: {
          ...row,
          ordinal: 9,
          state: 'SENT',
          envelope: { to: 'synthetic@example.com' },
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.program.delete({ where: { id: programId } }),
    ).rejects.toThrow();
  },
  BODY_TIMEOUT_MS,
);

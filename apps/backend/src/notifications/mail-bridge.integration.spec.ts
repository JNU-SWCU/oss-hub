import { createOwnedIntegrationDatabase } from '../../test/owned-integration-database.fixture';
import { ProgramMailJobRepository } from './program-mail-job.repository';
import { ProgramMailBatchPayloadRepository } from './program-mail-batch-payload.repository';
import { ProgramDeletionScopeRepository } from '../programs/programs.repository';
import { Prisma } from '@prisma/client';
import { AUDIT_SOURCE_QUERIES } from '../platform/audit-source.config';
import { ProgramMailAuditRepository } from './program-mail-audit.repository';
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

it(
  'imports a mixed terminal receipt twice without changing identities, audits or totals',
  async () => {
    const prisma = database.prisma;
    const result = {
      sentCount: 1,
      failedCount: 0,
      unknownCount: 1,
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
        {
          id: 'synthetic-sent',
          userId,
          type: 'PROGRAM_MAIL',
          channel: 'EMAIL',
          status: 'SENT',
          idempotencyKey: 'program-mail:synthetic:sent',
          payload: {
            schemaVersion: 1,
            batchKey: 'program-mail-send:synthetic',
          },
          sentAt: CREATED,
        },
        {
          id: 'synthetic-unknown',
          userId: otherUserId,
          type: 'PROGRAM_MAIL',
          channel: 'EMAIL',
          status: 'FAILED',
          idempotencyKey: 'program-mail:synthetic:unknown',
          payload: {
            schemaVersion: 1,
            batchKey: 'program-mail-send:synthetic',
            code: 'MAIL_DELIVERY_UNKNOWN',
          },
        },
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
      recipients: [
        {
          id: userId,
          displayName: 'Synthetic one',
          notificationEmail: 'one@example.invalid',
        },
        {
          id: otherUserId,
          displayName: 'Synthetic two',
          notificationEmail: 'two@example.invalid',
        },
      ],
    };
    await audit.recordAttempt(
      { input: content, batchKey: 'program-mail-send:synthetic' },
      prisma,
    );
    await audit.recordResult(
      {
        input: content,
        batchKey: 'program-mail-send:synthetic',
        result,
        occurredAt: CREATED,
      },
      prisma,
    );
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
    await prisma.notification.update({
      where: { id: 'synthetic-batch' },
      data: {
        payload: {
          schemaVersion: 1,
          programId,
          previewVersion: 'synthetic',
          result: { ...result, unknownCount: '1' },
        },
      },
    });
    await expect(
      prisma.$queryRaw`SELECT import_legacy_program_mail('synthetic-batch')`,
    ).rejects.toMatchObject({
      code: 'P2010',
      meta: { driverAdapterError: { cause: { originalCode: '22023' } } },
    });
    await prisma.notification.update({
      where: { id: 'synthetic-batch' },
      data: {
        payload: {
          schemaVersion: 1,
          programId,
          previewVersion: 'synthetic',
          result,
        },
      },
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
          payload: { batchKey: 'program-mail-send:no-audit' },
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
    await prisma.notification.create({
      data: {
        id: 'synthetic-shadow',
        userId: otherUserId,
        type: 'PROGRAM_MAIL',
        channel: 'EMAIL',
        status: 'FAILED',
        idempotencyKey: 'synthetic-shadow-key',
        payload: { code: 'MAIL_DELIVERY_UNKNOWN' },
        createdAt: CREATED,
      },
    });
    await prisma.mailJob.create({
      data: {
        id: 'synthetic-typed-status',
        receiptId: 'synthetic-typed-status',
        partNo: 0,
        source: 'DEADLINE_MANUAL',
        programId,
        actorId: userId,
        seoulDay: CREATED,
        state: 'QUARANTINED',
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
          deliveryKey: 'synthetic-new-unknown',
          state: 'UNKNOWN',
        },
      ],
    });
    expect(
      await new SystemStatusRepository(
        prisma,
        new PlatformRepository(),
      ).getMailStatus(new Date(0)),
    ).toEqual({ sent7d: 1, failed7d: 0, unknown7d: 2, lastSentAt: CREATED });
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

import { createOwnedIntegrationDatabase } from '../../test/owned-integration-database.fixture';
import { ProgramMailJobRepository } from './program-mail-job.repository';
import { ProgramMailBatchPayloadRepository } from './program-mail-batch-payload.repository';
import { ProgramDeletionScopeRepository } from '../programs/programs.repository';
import { Prisma } from '@prisma/client';
import { AUDIT_SOURCE_QUERIES } from '../platform/audit-source.config';

const SETUP_TIMEOUT_MS = 90_000;
const BODY_TIMEOUT_MS = 30_000;
const CREATED = new Date('2026-11-22T00:00:00.000Z');
let database: Awaited<ReturnType<typeof createOwnedIntegrationDatabase>>;
const programId = 'synthetic-mail-bridge';
const userId = 'synthetic-mail-bridge-user';

beforeEach(async () => {
  database = await createOwnedIntegrationDatabase();
  await database.prisma.user.create({
    data: {
      id: userId,
      githubId: 987654321234n,
      nickname: 'synthetic-mail-bridge',
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
          userId,
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

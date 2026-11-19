import type { Prisma } from '@prisma/client';
import { ProgramMailAuditRepository } from './program-mail-audit.repository';
import type { ProgramMailBatchContent } from './program-mail-send.types';

const input: ProgramMailBatchContent = {
  actorId: 'staff-1',
  programId: 'program-1',
  programName: 'Program 1',
  senderName: 'Staff 1',
  recipients: [],
  subject: 'Subject',
  body: 'Body',
  bodyHash: 'body-hash',
  bodyLength: 4,
  previewVersion: 'preview-1',
  occurredAt: new Date('2026-11-19T00:00:00.000Z'),
};

describe('ProgramMailAuditRepository', () => {
  it.each([
    [
      { sentCount: 2, duplicateCount: 0, failedCount: 0, unknownCount: 0 },
      'PROGRAM_MAIL_SENT',
    ],
    [
      { sentCount: 1, duplicateCount: 0, failedCount: 1, unknownCount: 0 },
      'PROGRAM_MAIL_PARTIALLY_FAILED',
    ],
    [
      { sentCount: 0, duplicateCount: 1, failedCount: 1, unknownCount: 0 },
      'PROGRAM_MAIL_PARTIALLY_FAILED',
    ],
    [
      { sentCount: 0, duplicateCount: 0, failedCount: 2, unknownCount: 0 },
      'PROGRAM_MAIL_FAILED',
    ],
    [
      { sentCount: 0, duplicateCount: 0, failedCount: 1, unknownCount: 1 },
      'PROGRAM_MAIL_PARTIALLY_FAILED',
    ],
    [
      { sentCount: 0, duplicateCount: 0, failedCount: 0, unknownCount: 2 },
      'PROGRAM_MAIL_DELIVERY_UNKNOWN',
    ],
    [
      { sentCount: 1, duplicateCount: 0, failedCount: 0, unknownCount: 1 },
      'PROGRAM_MAIL_DELIVERY_UNKNOWN',
    ],
  ] as const)('records delivery counts as %s', async (result, action) => {
    const create = jest
      .fn<Promise<unknown>, [Prisma.UserHistoryCreateArgs]>()
      .mockResolvedValue(undefined);

    await new ProgramMailAuditRepository().recordResult(
      {
        input,
        batchKey: 'program-mail-send:preview-1',
        result,
        occurredAt: new Date('2026-11-19T00:01:00.000Z'),
      },
      { userHistory: { create } } as never,
    );

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0].data.data).toMatchObject({
      action,
      metadata: result,
    });
  });
});

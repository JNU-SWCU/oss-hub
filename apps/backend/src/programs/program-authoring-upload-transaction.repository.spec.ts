import { ProgramAuthoringUploadLifecycle } from '@prisma/client';
import { ProgramAuthoringUploadTransactionRepository } from './files.repository';
import { type ProgramAuthoringUploadToken } from './files.config';
import { ProgramAuthoringUploadConsumptionRaceError, ProgramAuthoringUploadTokenError } from './program-authoring.error';

const ACTOR_ID = 'staff-id';

function upload(
  overrides: Partial<ProgramAuthoringUploadToken> = {},
): ProgramAuthoringUploadToken {
  return {
    id: 'upload-id',
    actorId: ACTOR_ID,
    lifecycle: ProgramAuthoringUploadLifecycle.PENDING,
    unexpired: true,
    storageKey: 'program-authoring/object-key',
    originalFileName: 'template.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 64,
    ...overrides,
  };
}

function transaction() {
  return {
    $queryRaw: jest.fn(),
    file: { updateMany: jest.fn() },
  };
}

describe('program authoring upload transaction', () => {
  it('locks upload tokens in stable id order before validating ownership and lifecycle', async () => {
    const prisma = transaction();
    prisma.$queryRaw.mockResolvedValue([
      upload({ id: 'a' }),
      upload({ id: 'b' }),
    ]);

    await expect(
      new ProgramAuthoringUploadTransactionRepository().lockAttachableProgramAuthoringUploads(
        prisma as never,
        ACTOR_ID,
        ['b', 'a'],
      ),
    ).resolves.toEqual([upload({ id: 'a' }), upload({ id: 'b' })]);

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('does not query when there are no tokens', async () => {
    const prisma = transaction();

    await expect(
      new ProgramAuthoringUploadTransactionRepository().lockProgramAuthoringUploads(
        prisma as never,
        [],
      ),
    ).resolves.toEqual([]);

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', ACTOR_ID, ['upload-id'], [], 'MISSING'],
    ['duplicate', ACTOR_ID, ['upload-id', 'upload-id'], [upload()], 'MISSING'],
    [
      'foreign',
      ACTOR_ID,
      ['upload-id'],
      [upload({ actorId: 'other' })],
      'NOT_OWNED',
    ],
    [
      'not pending',
      ACTOR_ID,
      ['upload-id'],
      [upload({ lifecycle: ProgramAuthoringUploadLifecycle.ATTACHED })],
      'NOT_PENDING',
    ],
    [
      'expired',
      ACTOR_ID,
      ['upload-id'],
      [upload({ unexpired: false })],
      'EXPIRED',
    ],
  ] as const)(
    'rejects %s upload tokens before consumption',
    (_case, actorId, tokenIds, uploads, reason) => {
      try {
        new ProgramAuthoringUploadTransactionRepository().assertAttachableProgramAuthoringUploads(
          actorId,
          tokenIds,
          uploads,
        );
        throw new Error('Expected upload validation to fail.');
      } catch (error) {
        expect(error).toBeInstanceOf(ProgramAuthoringUploadTokenError);
        expect(error).toMatchObject({ reason });
      }
    },
  );

  it('attaches each owned pending File in stable order after queueing the previous template', async () => {
    const prisma = transaction();
    prisma.file.updateMany.mockResolvedValue({ count: 1 });
    const first = upload({ id: 'a', storageKey: 'program-authoring/a' });
    const second = upload({ id: 'b', storageKey: 'program-authoring/b' });

    await new ProgramAuthoringUploadTransactionRepository().consumePendingProgramAuthoringUploads(
      prisma as never, ACTOR_ID,
      [{ milestoneDocumentId: 'document-b', upload: second }, { milestoneDocumentId: 'document-a', upload: first }],
    );

    expect(prisma.file.updateMany).toHaveBeenNthCalledWith(1, {
      where: {kind: 'TEMPLATE', requirementId: 'document-a', lifecycle: 'ATTACHED'},
      data: {lifecycle: 'DELETE_PENDING', nextDeleteAttemptAt: expect.any(Date)},
    });
    expect(prisma.file.updateMany).toHaveBeenNthCalledWith(2, {
      where: {id: 'a', uploaderId: ACTOR_ID, kind: 'UPLOAD', lifecycle: 'PENDING'},
      data: {kind: 'TEMPLATE', lifecycle: 'ATTACHED', requirementId: 'document-a', pendingExpiresAt: null, attachedAt: expect.any(Date)},
    });
    expect(prisma.file.updateMany).toHaveBeenNthCalledWith(4, {
      where: {id: 'b', uploaderId: ACTOR_ID, kind: 'UPLOAD', lifecycle: 'PENDING'},
      data: {kind: 'TEMPLATE', lifecycle: 'ATTACHED', requirementId: 'document-b', pendingExpiresAt: null, attachedAt: expect.any(Date)},
    });
  });

  it('throws when the pending File attachment loses its race', async () => {
    const prisma = transaction();
    prisma.file.updateMany.mockResolvedValue({ count: 0 });

    await expect(new ProgramAuthoringUploadTransactionRepository().consumePendingProgramAuthoringUploads(
      prisma as never, ACTOR_ID, [{ milestoneDocumentId: 'document-id', upload: upload() }],
    )).rejects.toEqual(expect.any(ProgramAuthoringUploadConsumptionRaceError));

    expect(prisma.file.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.file.updateMany).toHaveBeenLastCalledWith({
      where: {id: 'upload-id', uploaderId: ACTOR_ID, kind: 'UPLOAD', lifecycle: 'PENDING'},
      data: {kind: 'TEMPLATE', lifecycle: 'ATTACHED', requirementId: 'document-id', pendingExpiresAt: null, attachedAt: expect.any(Date)},
    });
  });
});

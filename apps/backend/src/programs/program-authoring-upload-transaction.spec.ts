import { ProgramAuthoringUploadLifecycle } from '@prisma/client';
import {
  assertAttachableProgramAuthoringUploads,
  consumePendingProgramAuthoringUploads,
  lockAttachableProgramAuthoringUploads,
  lockProgramAuthoringUploads,
} from './program-authoring-upload-transaction';
import {
  ProgramAuthoringUploadConsumptionRaceError,
  ProgramAuthoringUploadTokenError,
  type ProgramAuthoringUploadToken,
} from './program-authoring.types';

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
    milestoneDocumentTemplateFile: { upsert: jest.fn() },
    programAuthoringUpload: { deleteMany: jest.fn(), updateMany: jest.fn() },
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
      lockAttachableProgramAuthoringUploads(prisma as never, ACTOR_ID, [
        'b',
        'a',
      ]),
    ).resolves.toEqual([upload({ id: 'a' }), upload({ id: 'b' })]);

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('does not query when there are no tokens', async () => {
    const prisma = transaction();

    await expect(
      lockProgramAuthoringUploads(prisma as never, []),
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
        assertAttachableProgramAuthoringUploads(actorId, tokenIds, uploads);
        throw new Error('Expected upload validation to fail.');
      } catch (error) {
        expect(error).toBeInstanceOf(ProgramAuthoringUploadTokenError);
        expect(error).toMatchObject({ reason });
      }
    },
  );

  it('upserts exact upload metadata then deletes each pending row in stable order', async () => {
    const prisma = transaction();
    prisma.milestoneDocumentTemplateFile.upsert.mockResolvedValue({});
    prisma.programAuthoringUpload.deleteMany.mockResolvedValue({ count: 1 });
    const first = upload({ id: 'a', storageKey: 'program-authoring/a' });
    const second = upload({ id: 'b', storageKey: 'program-authoring/b' });

    await consumePendingProgramAuthoringUploads(prisma as never, ACTOR_ID, [
      { milestoneDocumentId: 'document-b', upload: second },
      { milestoneDocumentId: 'document-a', upload: first },
    ]);

    const uploadedAtMatcher: unknown = expect.any(Date);
    expect(prisma.milestoneDocumentTemplateFile.upsert).toHaveBeenNthCalledWith(
      1,
      {
        where: { milestoneDocumentId: 'document-a' },
        update: {
          storageKey: first.storageKey,
          originalFileName: first.originalFileName,
          mimeType: first.mimeType,
          sizeBytes: first.sizeBytes,
          uploadedById: ACTOR_ID,
          uploadedAt: uploadedAtMatcher,
        },
        create: {
          milestoneDocumentId: 'document-a',
          storageKey: first.storageKey,
          originalFileName: first.originalFileName,
          mimeType: first.mimeType,
          sizeBytes: first.sizeBytes,
          uploadedById: ACTOR_ID,
          uploadedAt: uploadedAtMatcher,
        },
      },
    );
    expect(prisma.programAuthoringUpload.deleteMany).toHaveBeenNthCalledWith(
      1,
      {
        where: {
          id: 'a',
          actorId: ACTOR_ID,
          lifecycle: ProgramAuthoringUploadLifecycle.PENDING,
        },
      },
    );
    expect(prisma.programAuthoringUpload.updateMany).not.toHaveBeenCalled();
    expect(prisma.programAuthoringUpload.deleteMany).toHaveBeenNthCalledWith(
      2,
      {
        where: {
          id: 'b',
          actorId: ACTOR_ID,
          lifecycle: ProgramAuthoringUploadLifecycle.PENDING,
        },
      },
    );
  });

  it('throws when the pending delete loses its race and never marks the upload ATTACHED', async () => {
    const prisma = transaction();
    prisma.milestoneDocumentTemplateFile.upsert.mockResolvedValue({});
    prisma.programAuthoringUpload.deleteMany.mockResolvedValue({ count: 0 });

    await expect(
      consumePendingProgramAuthoringUploads(prisma as never, ACTOR_ID, [
        { milestoneDocumentId: 'document-id', upload: upload() },
      ]),
    ).rejects.toEqual(expect.any(ProgramAuthoringUploadConsumptionRaceError));

    expect(prisma.programAuthoringUpload.deleteMany).toHaveBeenCalledWith({
      where: {
        id: 'upload-id',
        actorId: ACTOR_ID,
        lifecycle: ProgramAuthoringUploadLifecycle.PENDING,
      },
    });
    expect(prisma.programAuthoringUpload.updateMany).not.toHaveBeenCalled();
  });
});

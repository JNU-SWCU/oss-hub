import { ProgramAuthoringUploadLifecycle, type Prisma } from '@prisma/client';
import {
  assertAttachableProgramAuthoringUploads,
  lockProgramAuthoringUploads,
} from '../program-authoring-upload-transaction';
import {
  ProgramAuthoringUploadConsumptionRaceError,
  type ProgramAuthoringUploadToken,
} from '../program-authoring.types';
import { assertProgramCoverUpload } from '../program-cover';

export type ProgramCoverChange = {
  readonly actorId: string;
  readonly uploadId: string | null;
};

export async function replaceProgramCover(
  transaction: Prisma.TransactionClient,
  input: ProgramCoverChange & { readonly programId: string },
): Promise<void> {
  let upload: ProgramAuthoringUploadToken | null = null;
  if (input.uploadId !== null) {
    const uploads = await lockProgramAuthoringUploads(transaction, [
      input.uploadId,
    ]);
    assertAttachableProgramAuthoringUploads(
      input.actorId,
      [input.uploadId],
      uploads,
    );
    upload = uploads[0] ?? null;
    if (upload !== null) assertProgramCoverUpload(upload);
  }
  const previous = await transaction.programCover.findUnique({
    where: { programId: input.programId },
    select: { storageKey: true },
  });
  if (previous !== null) {
    await transaction.programPurgeFileTombstone.create({
      data: {
        storageKey: previous.storageKey,
        nextDeleteAttemptAt: new Date(),
      },
    });
    await transaction.programCover.delete({
      where: { programId: input.programId },
    });
  }
  if (upload !== null) {
    await createProgramCover(transaction, {
      programId: input.programId,
      actorId: input.actorId,
      upload,
    });
  }
}

export async function createProgramCover(
  transaction: Prisma.TransactionClient,
  input: {
    readonly programId: string;
    readonly actorId: string;
    readonly upload: ProgramAuthoringUploadToken;
  },
): Promise<void> {
  assertProgramCoverUpload(input.upload);
  await transaction.programCover.create({
    data: {
      programId: input.programId,
      storageKey: input.upload.storageKey,
      mimeType: input.upload.mimeType,
      sizeBytes: input.upload.sizeBytes,
    },
  });
  const consumed = await transaction.programAuthoringUpload.deleteMany({
    where: {
      id: input.upload.id,
      actorId: input.actorId,
      lifecycle: ProgramAuthoringUploadLifecycle.PENDING,
    },
  });
  if (consumed.count !== 1) {
    throw new ProgramAuthoringUploadConsumptionRaceError(input.upload.id);
  }
}

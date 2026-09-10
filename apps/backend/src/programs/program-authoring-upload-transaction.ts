import { Prisma, ProgramAuthoringUploadLifecycle } from '@prisma/client';
import {
  PROGRAM_AUTHORING_UPLOAD_TOKEN_FAILURE,
  ProgramAuthoringUploadConsumptionRaceError,
  ProgramAuthoringUploadTokenError,
  type ProgramAuthoringPendingUploadConsumption,
  type ProgramAuthoringUploadToken,
} from './program-authoring.types';
import { assertProgramTemplateUpload } from './program-cover';

export async function lockAttachableProgramAuthoringUploads(
  transaction: Prisma.TransactionClient,
  actorId: string,
  tokenIds: readonly string[],
): Promise<readonly ProgramAuthoringUploadToken[]> {
  const uploads = await lockProgramAuthoringUploads(transaction, tokenIds);
  assertAttachableProgramAuthoringUploads(actorId, tokenIds, uploads);
  uploads.forEach(assertProgramTemplateUpload);
  return uploads;
}

export function lockProgramAuthoringUploads(
  transaction: Prisma.TransactionClient,
  tokenIds: readonly string[],
): Promise<readonly ProgramAuthoringUploadToken[]> {
  if (tokenIds.length === 0) return Promise.resolve([]);
  return transaction.$queryRaw<
    readonly ProgramAuthoringUploadToken[]
  >(Prisma.sql`
    SELECT "id", "actorId", "lifecycle", ("expiresAt" > NOW()) AS "unexpired",
           "storageKey", "originalFileName", "mimeType", "sizeBytes"
    FROM "ProgramAuthoringUpload"
    WHERE "id" IN (${Prisma.join(tokenIds)})
    ORDER BY "id"
    FOR UPDATE
  `);
}

export function assertAttachableProgramAuthoringUploads(
  actorId: string,
  tokenIds: readonly string[],
  uploads: readonly ProgramAuthoringUploadToken[],
): void {
  if (uploads.length !== tokenIds.length) {
    throw new ProgramAuthoringUploadTokenError(
      PROGRAM_AUTHORING_UPLOAD_TOKEN_FAILURE.MISSING,
      tokenIds,
    );
  }
  for (const upload of uploads) {
    if (upload.actorId !== actorId) {
      throw new ProgramAuthoringUploadTokenError(
        PROGRAM_AUTHORING_UPLOAD_TOKEN_FAILURE.NOT_OWNED,
        [upload.id],
      );
    }
    if (upload.lifecycle !== ProgramAuthoringUploadLifecycle.PENDING) {
      throw new ProgramAuthoringUploadTokenError(
        PROGRAM_AUTHORING_UPLOAD_TOKEN_FAILURE.NOT_PENDING,
        [upload.id],
      );
    }
    if (!upload.unexpired) {
      throw new ProgramAuthoringUploadTokenError(
        PROGRAM_AUTHORING_UPLOAD_TOKEN_FAILURE.EXPIRED,
        [upload.id],
      );
    }
  }
}

export async function consumePendingProgramAuthoringUploads(
  transaction: Prisma.TransactionClient,
  actorId: string,
  consumptions: readonly ProgramAuthoringPendingUploadConsumption[],
): Promise<void> {
  const sortedConsumptions = [...consumptions].sort((left, right) =>
    left.upload.id.localeCompare(right.upload.id),
  );
  for (const consumption of sortedConsumptions) {
    const { milestoneDocumentId, upload } = consumption;
    assertProgramTemplateUpload(upload);
    const uploadedAt = new Date();
    await transaction.milestoneDocumentTemplateFile.upsert({
      where: { milestoneDocumentId },
      update: {
        storageKey: upload.storageKey,
        originalFileName: upload.originalFileName,
        mimeType: upload.mimeType,
        sizeBytes: upload.sizeBytes,
        uploadedById: actorId,
        uploadedAt,
      },
      create: {
        milestoneDocumentId,
        storageKey: upload.storageKey,
        originalFileName: upload.originalFileName,
        mimeType: upload.mimeType,
        sizeBytes: upload.sizeBytes,
        uploadedById: actorId,
        uploadedAt,
      },
    });
    const deleted = await transaction.programAuthoringUpload.deleteMany({
      where: {
        id: upload.id,
        actorId,
        lifecycle: ProgramAuthoringUploadLifecycle.PENDING,
      },
    });
    if (deleted.count !== 1) {
      throw new ProgramAuthoringUploadConsumptionRaceError(upload.id);
    }
  }
}

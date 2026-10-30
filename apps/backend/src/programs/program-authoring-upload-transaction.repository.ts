import { Prisma, ProgramAuthoringUploadLifecycle } from '@prisma/client';
import {
  PROGRAM_AUTHORING_UPLOAD_TOKEN_FAILURE,
  ProgramAuthoringUploadConsumptionRaceError,
  ProgramAuthoringUploadTokenError,
  type ProgramAuthoringPendingUploadConsumption,
  type ProgramAuthoringUploadToken,
} from './program-authoring.policy';
import { assertProgramTemplateUpload } from './program-cover.policy';

export class ProgramAuthoringUploadTransactionRepository {
  static async lockAttachableProgramAuthoringUploads(
    transaction: Prisma.TransactionClient,
    actorId: string,
    tokenIds: readonly string[],
  ): Promise<readonly ProgramAuthoringUploadToken[]> {
    const uploads =
      await ProgramAuthoringUploadTransactionRepository.lockProgramAuthoringUploads(
        transaction,
        tokenIds,
      );
    ProgramAuthoringUploadTransactionRepository.assertAttachableProgramAuthoringUploads(
      actorId,
      tokenIds,
      uploads,
    );
    uploads.forEach(assertProgramTemplateUpload);
    return uploads;
  }

  static lockProgramAuthoringUploads(
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

  static assertAttachableProgramAuthoringUploads(
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

  static async consumePendingProgramAuthoringUploads(
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
}

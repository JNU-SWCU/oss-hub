import {
  Prisma,
  ProgramAuthoringUploadLifecycle,
  type ProgramTrackType,
  type ProgramCategory,
  type MilestoneSubmissionType,
  type ProgramLifecycle,
} from '@prisma/client';
import {
  ProgramAuthoringUploadTokenError,
  PROGRAM_AUTHORING_UPLOAD_TOKEN_FAILURE,
  ProgramAuthoringUploadConsumptionRaceError,
} from './program-authoring.error';
import { type ProgramAuthoringUploadToken } from './program-authoring-upload.config';

export type ProgramExternalCover = {
  readonly sourceUrl: string;
  readonly imageUrl: string;
};

export type ProgramAuthoringDocumentRequest = {
  readonly name: string;
  readonly required: boolean;
  readonly templateUploadId?: string | null;
};

export type ProgramAuthoringMilestoneRequest = {
  readonly name: string;
  readonly startAt?: string;
  readonly dueAt: string;
  readonly instructions?: string | null;
  readonly documents: readonly ProgramAuthoringDocumentRequest[];
};

export type ProgramAuthoringRequest = {
  readonly coverUploadId?: string | null;
  readonly externalCover?: ProgramExternalCover | null;
  readonly name: string;
  readonly organizer: string;
  readonly trackType: ProgramTrackType;
  readonly applicationStartAt: string;
  readonly applicationEndAt: string;
  readonly startAt?: string;
  readonly endAt: string;
  readonly teamMinSize?: number | null;
  readonly teamMaxSize?: number | null;
  readonly description: string;
  readonly repositoryProvisioningEnabled?: boolean;
  readonly notifyOnDeadline?: boolean;
  readonly milestones: readonly ProgramAuthoringMilestoneRequest[];
};

export type ProgramAuthoringProgramPlan = {
  readonly name: string;
  readonly organizer: string;
  readonly category: ProgramCategory;
  readonly trackType: ProgramTrackType;
  readonly applicationTemplateKey: string;
  readonly applicationTemplateVersion: number;
  readonly applicationStartAt: Date;
  readonly applicationEndAt: Date;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly teamMinSize: number;
  readonly teamMaxSize: number;
  readonly description: string;
  readonly repositoryProvisioningEnabled: boolean;
  readonly notifyOnDeadline: boolean;
};

export type ProgramAuthoringDocumentPlan = {
  readonly name: string;
  readonly required: boolean;
  readonly sortOrder: number;
  readonly templateUploadId: string;
};

export type ProgramAuthoringMilestonePlan = {
  readonly name: string;
  readonly startAt: Date;
  readonly dueAt: Date;
  readonly submissionType: MilestoneSubmissionType | null;
  readonly instructions: string | null;
  readonly documents: readonly ProgramAuthoringDocumentPlan[];
};

export type ProgramAuthoringPlan = {
  readonly coverUploadId?: string | null;
  readonly externalCover?: ProgramExternalCover;
  readonly program: ProgramAuthoringProgramPlan;
  readonly milestones: readonly ProgramAuthoringMilestonePlan[];
  readonly uploadTokenIds: readonly string[];
};

export type ProgramAuthoringProgram = ProgramAuthoringProgramPlan & {
  readonly id: string;
  readonly lifecycle: ProgramLifecycle;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type ProgramAuthoringReplay = {
  readonly payloadHash: string;
  readonly program: ProgramAuthoringProgram;
};

export type ProgramAuthoringCreateRequestInput = {
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
  readonly programId: string;
};

export type ProgramAuthoringTemplateInput = {
  readonly milestoneDocumentId: string;
  readonly actorId: string;
  readonly upload: ProgramAuthoringUploadToken;
};

export type ProgramAuthoringPendingUploadConsumption = {
  readonly milestoneDocumentId: string;
  readonly upload: ProgramAuthoringUploadToken;
};

export interface ValidatedProgramAuthoringUpload {
  readonly body: Buffer;
  readonly originalFileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

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

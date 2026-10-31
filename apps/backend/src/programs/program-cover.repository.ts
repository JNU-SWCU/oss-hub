import { PROGRAM_COVER_MAX_BYTES } from './submission-upload.config';
import { Injectable } from '@nestjs/common';
import {
  ProgramLifecycle,
  ProgramAuthoringUploadLifecycle,
  type Prisma,
} from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import {
  ProgramAuthoringUploadTransactionRepository,
  type ProgramExternalCover,
} from './program-authoring-upload-transaction.repository';
import { type ProgramAuthoringUploadToken } from './program-authoring-upload.config';
import { ProgramAuthoringUploadConsumptionRaceError } from './program-authoring.error';
import { PROGRAM_COVER_STORAGE_PREFIX } from './program-cover.config';

export type ProgramCoverChange = {
  readonly actorId: string;
} & (
  | {
      readonly uploadId: string | null;
      readonly externalCover?: never;
      readonly assertUpload: (upload: ProgramAuthoringUploadToken) => void;
    }
  | {
      readonly externalCover: ProgramExternalCover | null;
      readonly uploadId?: never;
    }
);

@Injectable()
export class ProgramCoverRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly programAuthoringUploadTransactionRepository: ProgramAuthoringUploadTransactionRepository,
  ) {}

  async findPublicCover(programId: string, coverId: string) {
    const cover = await this.prisma.programCover.findFirst({
      where: {
        id: coverId,
        programId,
        source: 'OWNED',
        program: {
          lifecycle: {
            in: [ProgramLifecycle.PUBLISHED, ProgramLifecycle.ARCHIVED],
          },
        },
        storageKey: { startsWith: PROGRAM_COVER_STORAGE_PREFIX },
        mimeType: { in: ['image/jpeg', 'image/png'] },
        sizeBytes: { gte: 1, lte: PROGRAM_COVER_MAX_BYTES },
      },
      select: { storageKey: true, mimeType: true, sizeBytes: true },
    });
    if (
      cover?.storageKey == null ||
      cover.mimeType === null ||
      cover.sizeBytes === null
    )
      return null;
    return {
      storageKey: cover.storageKey,
      mimeType: cover.mimeType,
      sizeBytes: cover.sizeBytes,
    };
  }

  async replaceProgramCover(
    transaction: Prisma.TransactionClient,
    input: ProgramCoverChange & { readonly programId: string },
  ): Promise<void> {
    let upload: ProgramAuthoringUploadToken | null = null;
    if (input.uploadId != null) {
      const uploads =
        await this.programAuthoringUploadTransactionRepository.lockProgramAuthoringUploads(
          transaction,
          [input.uploadId],
        );
      this.programAuthoringUploadTransactionRepository.assertAttachableProgramAuthoringUploads(
        input.actorId,
        [input.uploadId],
        uploads,
      );
      upload = uploads[0] ?? null;
      if (upload !== null) input.assertUpload(upload);
    }
    const previous = await transaction.programCover.findUnique({
      where: { programId: input.programId },
      select: { storageKey: true },
    });
    if (previous !== null) {
      if (previous.storageKey !== null) {
        await transaction.programPurgeFileTombstone.create({
          data: {
            storageKey: previous.storageKey,
            nextDeleteAttemptAt: new Date(),
          },
        });
      }
      await transaction.programCover.delete({
        where: { programId: input.programId },
      });
    }
    if (upload !== null) {
      await this.createProgramCover(transaction, {
        programId: input.programId,
        actorId: input.actorId,
        upload,
      });
    } else if (input.externalCover != null) {
      await this.createExternalProgramCover(
        transaction,
        input.programId,
        input.externalCover,
      );
    }
  }

  async createExternalProgramCover(
    transaction: Prisma.TransactionClient,
    programId: string,
    externalCover: ProgramExternalCover,
  ): Promise<void> {
    await transaction.programCover.create({
      data: { programId, source: 'EXTERNAL', ...externalCover },
    });
  }

  async createProgramCover(
    transaction: Prisma.TransactionClient,
    input: {
      readonly programId: string;
      readonly actorId: string;
      readonly upload: ProgramAuthoringUploadToken;
    },
  ): Promise<void> {
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
}

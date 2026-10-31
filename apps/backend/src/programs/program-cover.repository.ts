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
  type ProgramAuthoringUploadToken,
  type ProgramExternalCover,
} from './program-authoring-upload-transaction.repository';
import {
  ProgramAuthoringUploadTokenError,
  ProgramAuthoringUploadConsumptionRaceError,
} from './program-authoring.error';

export type ProgramCoverChange = {
  readonly actorId: string;
} & (
  | { readonly uploadId: string | null; readonly externalCover?: never }
  | {
      readonly externalCover: ProgramExternalCover | null;
      readonly uploadId?: never;
    }
);

export const PROGRAM_COVER_STORAGE_PREFIX = 'program-covers/';

export function programCoverImageUrl(
  programId: string,
  coverId: string | null | undefined,
  externalImageUrl?: string | null,
): string | null {
  if (externalImageUrl != null) return externalImageUrl;
  return coverId
    ? `/programs/${encodeURIComponent(programId)}/cover/${encodeURIComponent(coverId)}`
    : null;
}

export function assertProgramCoverUpload(
  upload: ProgramAuthoringUploadToken,
): void {
  if (
    !upload.storageKey.startsWith(PROGRAM_COVER_STORAGE_PREFIX) ||
    !['image/jpeg', 'image/png'].includes(upload.mimeType) ||
    upload.sizeBytes < 1 ||
    upload.sizeBytes > PROGRAM_COVER_MAX_BYTES
  ) {
    throw new ProgramAuthoringUploadTokenError('WRONG_PURPOSE', [upload.id]);
  }
}

@Injectable()
export class ProgramCoverRepository {
  constructor(private readonly prisma: PrismaService) {}

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
}

export async function replaceProgramCover(
  transaction: Prisma.TransactionClient,
  input: ProgramCoverChange & { readonly programId: string },
): Promise<void> {
  let upload: ProgramAuthoringUploadToken | null = null;
  if (input.uploadId != null) {
    const uploads =
      await ProgramAuthoringUploadTransactionRepository.lockProgramAuthoringUploads(
        transaction,
        [input.uploadId],
      );
    ProgramAuthoringUploadTransactionRepository.assertAttachableProgramAuthoringUploads(
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
    await createProgramCover(transaction, {
      programId: input.programId,
      actorId: input.actorId,
      upload,
    });
  } else if (input.externalCover != null) {
    await createExternalProgramCover(
      transaction,
      input.programId,
      input.externalCover,
    );
  }
}

export async function createExternalProgramCover(
  transaction: Prisma.TransactionClient,
  programId: string,
  externalCover: ProgramExternalCover,
): Promise<void> {
  await transaction.programCover.create({
    data: { programId, source: 'EXTERNAL', ...externalCover },
  });
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

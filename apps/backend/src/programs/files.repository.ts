import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { FileLifecycle, Prisma, AccountStatus } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import {
  ProgramAuthoringUploadConsumptionRaceError,
  ProgramAuthoringUploadTokenError,
  PROGRAM_AUTHORING_UPLOAD_TOKEN_FAILURE,
} from './programs.error';
import {
  type ProgramAuthoringUploadToken,
  type ProgramExternalCover,
  type ProgramAuthoringPendingUploadConsumption,
} from './files.config';
import { PROGRAM_COVER_MAX_BYTES } from './submission-upload.config';
import { PROGRAM_COVER_STORAGE_PREFIX } from './program-cover.config';
import {
  USER_AUTHORITY_SELECT,
  STUDENT_MEMBER_WHERE,
} from '../platform/user-profile-read.config';
import { PlatformRepository } from '../platform/platform.repository';
import { SubmissionMembershipChangedError } from './submissions.error';
import {
  SubmissionFileQuotaExceededError,
  SubmissionFileRetentionUnavailableError,
} from './files.error';

export type ProgramCoverChange = { readonly actorId: string } & (
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

export type ClaimedFile = {
  readonly id: string;
  readonly storageKey: string;
  readonly deleteAttemptCount: number;
  readonly claimOwner: string;
};

export type ProgramAuthoringUploadDeleteRequestResult =
  | { readonly kind: 'QUEUED' }
  | { readonly kind: 'IDEMPOTENT' }
  | { readonly kind: 'NOT_FOUND' }
  | { readonly kind: 'ATTACHED' };

export interface CreatePendingProgramAuthoringUploadInput {
  readonly actorId: string;
  readonly storageKey: string;
  readonly originalFileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly expiresAt: Date;
}

@Injectable()
export class FileCleanupRepository {
  constructor(private readonly prisma: PrismaService) {}

  async claimNextForDeletion(input: {
    readonly now: Date;
    readonly leaseExpiresAt: Date;
  }): Promise<ClaimedFile | null> {
    const claimOwner = randomUUID();
    const rows = await this.prisma.$queryRaw<ClaimedFile[]>(Prisma.sql`
      WITH candidate AS (
        SELECT file."id"
        FROM "File" file
        WHERE file."deleteAttemptCount" < 6
          AND (file."deleteClaimExpiresAt" IS NULL OR file."deleteClaimExpiresAt" <= ${input.now})
          AND (
            (file.lifecycle='PENDING' AND file."pendingExpiresAt" <= ${input.now})
            OR (file.lifecycle='ATTACHED' AND file."expiresAt" <= ${input.now})
            OR (
              file.lifecycle IN ('PENDING','ATTACHED')
              AND (
                EXISTS (SELECT 1 FROM "Program" program WHERE program.id=file."programId" AND program.lifecycle='DELETED')
                OR EXISTS (
                  SELECT 1 FROM "Requirement" requirement
                  JOIN "Milestone" milestone ON milestone.id=requirement."milestoneId"
                  JOIN "Program" program ON program.id=milestone."programId"
                  WHERE requirement.id=file."requirementId" AND program.lifecycle='DELETED'
                )
                OR EXISTS (
                  SELECT 1 FROM "SubmissionHistory" history
                  JOIN "Submission" submission ON submission.id=history."submissionId"
                  JOIN "Requirement" requirement ON requirement.id=submission."requirementId"
                  JOIN "Milestone" milestone ON milestone.id=requirement."milestoneId"
                  JOIN "Program" program ON program.id=milestone."programId"
                  WHERE history.id=file."submissionHistoryId" AND program.lifecycle='DELETED'
                )
              )
            )
            OR (
              file.lifecycle='DELETE_PENDING'
              AND (
                file."deleteClaimExpiresAt" <= ${input.now}
                OR (file."deleteClaimExpiresAt" IS NULL AND file."nextDeleteAttemptAt" <= ${input.now})
              )
            )
          )
        ORDER BY COALESCE(file."nextDeleteAttemptAt", file."pendingExpiresAt", file."expiresAt", file."createdAt"), file.id
        FOR UPDATE OF file SKIP LOCKED
        LIMIT 1
      )
      UPDATE "File" file
      SET lifecycle='DELETE_PENDING',
          "deleteClaimedAt"=${input.now},
          "deleteClaimExpiresAt"=${input.leaseExpiresAt},
          "deleteClaimOwner"=${claimOwner},
          "nextDeleteAttemptAt"=COALESCE(file."nextDeleteAttemptAt",${input.now}),
          "updatedAt"=${input.now}
      FROM candidate WHERE file.id=candidate.id
      RETURNING file.id, file."storageKey", file."deleteAttemptCount",
                file."deleteClaimOwner" AS "claimOwner"
    `);
    return rows[0] ?? null;
  }

  async markDeleted(id: string, claimOwner: string, deletedAt: Date) {
    const result = await this.prisma.file.updateMany({
      where: { id, lifecycle: 'DELETE_PENDING', deleteClaimOwner: claimOwner },
      data: {
        lifecycle: 'DELETED',
        deletedAt,
        deleteClaimedAt: null,
        deleteClaimExpiresAt: null,
        deleteClaimOwner: null,
        nextDeleteAttemptAt: null,
        lastDeleteError: null,
      },
    });
    return result.count === 1;
  }

  async recordDeleteFailure(input: {
    readonly id: string;
    readonly claimOwner: string;
    readonly attemptCount: number;
    readonly nextAttemptAt: Date | null;
    readonly error: 'STORAGE_DELETE_FAILED';
  }) {
    const result = await this.prisma.file.updateMany({
      where: {
        id: input.id,
        lifecycle: 'DELETE_PENDING',
        deleteClaimOwner: input.claimOwner,
        deleteAttemptCount: input.attemptCount - 1,
      },
      data: {
        deleteAttemptCount: input.attemptCount,
        nextDeleteAttemptAt: input.nextAttemptAt,
        lastDeleteError: input.error,
        deleteClaimedAt: null,
        deleteClaimExpiresAt: null,
        deleteClaimOwner: null,
      },
    });
    return result.count === 1;
  }
}

@Injectable()
export class ProgramAuthoringUploadRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createPending(input: CreatePendingProgramAuthoringUploadInput) {
    const { actorId, expiresAt, ...metadata } = input;
    const file = await this.prisma.file.create({
      data: {
        ...metadata,
        uploaderId: actorId,
        pendingExpiresAt: expiresAt,
        kind: 'UPLOAD',
        lifecycle: 'PENDING',
      },
      select: { id: true },
    });
    return { ...metadata, id: file.id, expiresAt };
  }

  async requestDelete(
    actorId: string,
    id: string,
    requestedAt: Date,
  ): Promise<ProgramAuthoringUploadDeleteRequestResult> {
    const changed = await this.prisma.file.updateMany({
      where: { id, uploaderId: actorId, kind: 'UPLOAD', lifecycle: 'PENDING' },
      data: { lifecycle: 'DELETE_PENDING', nextDeleteAttemptAt: requestedAt },
    });
    if (changed.count === 1) return { kind: 'QUEUED' };
    const file = await this.prisma.file.findFirst({
      where: {
        id,
        uploaderId: actorId,
        kind: { in: ['UPLOAD', 'COVER', 'TEMPLATE'] },
      },
      select: { lifecycle: true },
    });
    if (file === null) return { kind: 'NOT_FOUND' };
    switch (file.lifecycle) {
      case FileLifecycle.PENDING:
        return { kind: 'NOT_FOUND' };
      case FileLifecycle.ATTACHED:
        return { kind: 'ATTACHED' };
      case FileLifecycle.DELETE_PENDING:
      case FileLifecycle.DELETED:
        return { kind: 'IDEMPOTENT' };
    }
  }
}

@Injectable()
export class ProgramAuthoringUploadTransactionRepository {
  async lockAttachableProgramAuthoringUploads(
    transaction: Prisma.TransactionClient,
    actorId: string,
    tokenIds: readonly string[],
  ) {
    const uploads = await this.lockProgramAuthoringUploads(
      transaction,
      tokenIds,
    );
    this.assertAttachableProgramAuthoringUploads(actorId, tokenIds, uploads);
    return uploads;
  }

  lockProgramAuthoringUploads(
    transaction: Prisma.TransactionClient,
    tokenIds: readonly string[],
  ): Promise<readonly ProgramAuthoringUploadToken[]> {
    if (tokenIds.length === 0) return Promise.resolve([]);
    return transaction.$queryRaw<
      readonly ProgramAuthoringUploadToken[]
    >(Prisma.sql`
      SELECT id, "uploaderId" AS "actorId", lifecycle,
             ("pendingExpiresAt" > NOW()) AS unexpired,
             "storageKey", "originalFileName", "mimeType", "sizeBytes"
      FROM "File" WHERE id IN (${Prisma.join(tokenIds)}) AND kind IN ('UPLOAD','TEMPLATE','COVER')
      ORDER BY id FOR UPDATE
    `);
  }

  assertAttachableProgramAuthoringUploads(
    actorId: string,
    tokenIds: readonly string[],
    uploads: readonly ProgramAuthoringUploadToken[],
  ) {
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
      if (upload.lifecycle !== FileLifecycle.PENDING) {
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

  async consumePendingProgramAuthoringUploads(
    transaction: Prisma.TransactionClient,
    actorId: string,
    consumptions: readonly ProgramAuthoringPendingUploadConsumption[],
  ) {
    for (const { milestoneDocumentId, upload } of [...consumptions].sort(
      (left, right) => left.upload.id.localeCompare(right.upload.id),
    )) {
      await transaction.file.updateMany({
        where: {
          kind: 'TEMPLATE',
          requirementId: milestoneDocumentId,
          lifecycle: 'ATTACHED',
        },
        data: { lifecycle: 'DELETE_PENDING', nextDeleteAttemptAt: new Date() },
      });
      const attached = await transaction.file.updateMany({
        where: {
          id: upload.id,
          uploaderId: actorId,
          kind: 'UPLOAD',
          lifecycle: 'PENDING',
        },
        data: {
          kind: 'TEMPLATE',
          lifecycle: 'ATTACHED',
          requirementId: milestoneDocumentId,
          pendingExpiresAt: null,
          attachedAt: new Date(),
        },
      });
      if (attached.count !== 1) {
        throw new ProgramAuthoringUploadConsumptionRaceError(upload.id);
      }
    }
  }
}

@Injectable()
export class ProgramCoverRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: ProgramAuthoringUploadTransactionRepository,
  ) {}

  async findPublicCover(programId: string, coverId: string) {
    const cover = await this.prisma.file.findFirst({
      where: {
        id: coverId,
        kind: 'COVER',
        lifecycle: 'ATTACHED',
        programId,
        coverForProgram: {
          id: programId,
          lifecycle: 'PUBLISHED',
        },
        storageKey: { startsWith: PROGRAM_COVER_STORAGE_PREFIX },
        mimeType: { in: ['image/jpeg', 'image/png'] },
        sizeBytes: { gte: 1, lte: PROGRAM_COVER_MAX_BYTES },
      },
      select: { storageKey: true, mimeType: true, sizeBytes: true },
    });
    if (cover === null || cover.mimeType === null || cover.sizeBytes === null)
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
  ) {
    let upload: ProgramAuthoringUploadToken | null = null;
    if (input.uploadId != null) {
      const uploads = await this.uploads.lockAttachableProgramAuthoringUploads(
        transaction,
        input.actorId,
        [input.uploadId],
      );
      upload = uploads[0] ?? null;
      if (upload !== null) input.assertUpload(upload);
    }
    const previous = await transaction.program.findUniqueOrThrow({
      where: { id: input.programId },
      select: { coverFileId: true },
    });
    if (previous.coverFileId !== null) {
      await transaction.file.update({
        where: { id: previous.coverFileId },
        data: { lifecycle: 'DELETE_PENDING', nextDeleteAttemptAt: new Date() },
      });
    }
    await transaction.program.update({
      where: { id: input.programId },
      data: { coverFileId: null, coverSourceUrl: null, coverImageUrl: null },
    });
    if (upload !== null) {
      await this.createProgramCover(transaction, { ...input, upload });
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
  ) {
    await transaction.program.update({
      where: { id: programId },
      data: {
        coverSourceUrl: externalCover.sourceUrl,
        coverImageUrl: externalCover.imageUrl,
      },
    });
  }

  async createProgramCover(
    transaction: Prisma.TransactionClient,
    input: {
      readonly programId: string;
      readonly actorId: string;
      readonly upload: ProgramAuthoringUploadToken;
    },
  ) {
    const attached = await transaction.file.updateMany({
      where: {
        id: input.upload.id,
        uploaderId: input.actorId,
        kind: 'UPLOAD',
        lifecycle: 'PENDING',
      },
      data: {
        kind: 'COVER',
        lifecycle: 'ATTACHED',
        programId: input.programId,
        pendingExpiresAt: null,
        attachedAt: new Date(),
      },
    });
    if (attached.count !== 1)
      throw new ProgramAuthoringUploadConsumptionRaceError(input.upload.id);
    await transaction.program.update({
      where: { id: input.programId },
      data: {
        coverFileId: input.upload.id,
        coverSourceUrl: null,
        coverImageUrl: null,
      },
    });
  }
}

const MAX_DELETE_ATTEMPTS = 6;
const MAX_RETAINED_FILE_COUNT = 100;
const MAX_RETAINED_FILE_BYTES = 500 * 1024 * 1024;
export interface CreatePendingSubmissionFileInput {
  readonly uploaderId: string;
  readonly teamId: string;
  readonly milestoneId: string;
  readonly milestoneDocumentId: string;
  readonly storageKey: string;
  readonly originalFileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly pendingExpiresAt: Date;
  readonly resolveExpiresAt: (programEndAt: Date) => Date;
}

export interface DownloadableSubmissionFile {
  readonly id: string;
  readonly storageKey: string;
  readonly originalFileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly expiresAt: Date;
}
export interface SubmissionFileCleanupOperator {
  readonly githubId: bigint;
  readonly hasAdminAccess: boolean;
  readonly accountStatus: AccountStatus;
}
export interface ExhaustedSubmissionFileCleanup {
  readonly id: string;
  readonly deleteAttemptCount: number;
  readonly lastDeleteError: string | null;
  readonly createdAt: Date;
}

@Injectable()
export class FileMetadataRepository {
  read<
    T extends {
      readonly originalFileName: string | null;
      readonly mimeType: string | null;
      readonly sizeBytes: number | null;
    },
  >(this: void, file: T) {
    const { originalFileName, mimeType, sizeBytes } = file;
    if (originalFileName === null || mimeType === null || sizeBytes === null) {
      throw new TypeError('File metadata is missing');
    }
    return { ...file, originalFileName, mimeType, sizeBytes };
  }
}

@Injectable()
export class FilesRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platformRepository: PlatformRepository,
    private readonly fileMetadata: FileMetadataRepository,
  ) {}
  async findActiveStudentByGithubId(githubId: bigint): Promise<string | null> {
    const user = await this.prisma.user.findFirst({
      where: {
        githubId,
        accountStatus: AccountStatus.ACTIVE,
        ...STUDENT_MEMBER_WHERE,
      },
      select: { id: true },
    });
    return user?.id ?? null;
  }
  async findActiveAdminByGithubId(githubId: bigint): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { githubId },
      select: {
        ...USER_AUTHORITY_SELECT,
        accountStatus: true,
      },
    });
    return user?.accountStatus === AccountStatus.ACTIVE && user.admin !== null;
  }
  async findCleanupOperator(
    operatorId: string,
  ): Promise<SubmissionFileCleanupOperator | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: operatorId },
      select: {
        githubId: true,
        admin: { select: { userId: true } },
        accountStatus: true,
      },
    });
    return user === null
      ? null
      : {
          githubId: user.githubId,
          hasAdminAccess: user.admin !== null,
          accountStatus: user.accountStatus,
        };
  }
  findExhaustedCleanups(): Promise<ExhaustedSubmissionFileCleanup[]> {
    return this.prisma.file.findMany({
      where: {
        lifecycle: FileLifecycle.DELETE_PENDING,
        deleteAttemptCount: { gte: MAX_DELETE_ATTEMPTS },
      },
      select: {
        id: true,
        deleteAttemptCount: true,
        lastDeleteError: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }
  async findDownloadableFile(
    githubId: bigint,
    fileId: string,
    now: Date,
  ): Promise<DownloadableSubmissionFile | null> {
    const user = await this.prisma.user.findUnique({
      where: { githubId },
      select: {
        id: true,
        ...USER_AUTHORITY_SELECT,
        accountStatus: true,
      },
    });
    if (user?.accountStatus !== AccountStatus.ACTIVE) return null;
    if (
      user.type === 'STAFF' &&
      user.approvalStatus === 'APPROVED' &&
      user.profileCreatedAt !== null &&
      user.name !== null &&
      user.department !== null
    ) {
      return this.findAuthorizedDownloadableFile({
        ...downloadableFileWhere(fileId, now),
      });
    }
    return this.findAuthorizedDownloadableFile({
      ...downloadableFileWhere(fileId, now),
      team: {
        is: this.platformRepository.programApplicationParticipantWhere(user.id),
      },
    });
  }
  createPending(input: CreatePendingSubmissionFileInput) {
    return this.prisma.$transaction(async (transaction) => {
      const stillMember =
        await this.platformRepository.lockSubmissionMembership(
          transaction,
          input.teamId,
          input.uploaderId,
        );
      if (!stillMember) {
        throw new SubmissionMembershipChangedError(
          input.teamId,
          input.uploaderId,
        );
      }
      const programs = await transaction.$queryRaw<
        readonly {
          endAt: Date;
        }[]
      >(Prisma.sql`
        SELECT program."endAt"
        FROM "Program" AS program
        INNER JOIN "Team" AS team
          ON team."programId" = program."id"
        WHERE team."id" = ${input.teamId}
        FOR UPDATE OF program
      `);
      const program = programs[0];
      if (!program) {
        throw new SubmissionFileRetentionUnavailableError();
      }
      await transaction.$queryRaw<
        readonly {
          id: string;
        }[]
      >(Prisma.sql`
        SELECT "id"
        FROM "User"
        WHERE "id" = ${input.uploaderId}
        FOR UPDATE
      `);
      const retained = await transaction.file.aggregate({
        where: {
          kind: 'SUBMISSION',
          uploaderId: input.uploaderId,
          lifecycle: { not: FileLifecycle.DELETED },
        },
        _count: { _all: true },
        _sum: { sizeBytes: true },
      });
      if (
        retained._count._all >= MAX_RETAINED_FILE_COUNT ||
        (retained._sum.sizeBytes ?? 0) + input.sizeBytes >
          MAX_RETAINED_FILE_BYTES
      ) {
        throw new SubmissionFileQuotaExceededError();
      }
      const created = await transaction.file.create({
        data: {
          uploaderId: input.uploaderId,
          kind: 'SUBMISSION',
          teamId: input.teamId,
          requirementId: input.milestoneDocumentId,
          storageKey: input.storageKey,
          originalFileName: input.originalFileName,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          lifecycle: FileLifecycle.PENDING,
          pendingExpiresAt: input.pendingExpiresAt,
          expiresAt: input.resolveExpiresAt(program.endAt),
        },
        select: {
          id: true,
          originalFileName: true,
          mimeType: true,
          sizeBytes: true,
          expiresAt: true,
        },
      });
      return {
        ...this.fileMetadata.read(created),
        expiresAt: input.resolveExpiresAt(program.endAt),
      };
    });
  }
  async resetDeleteAttempts(id: string, now: Date): Promise<boolean> {
    const result = await this.prisma.file.updateMany({
      where: {
        id,
        lifecycle: FileLifecycle.DELETE_PENDING,
        deleteAttemptCount: MAX_DELETE_ATTEMPTS,
      },
      data: {
        deleteAttemptCount: 0,
        nextDeleteAttemptAt: now,
        lastDeleteError: null,
        deleteClaimedAt: null,
        deleteClaimExpiresAt: null,
        deleteClaimOwner: null,
      },
    });
    return result.count === 1;
  }
  private async findAuthorizedDownloadableFile(
    where: Prisma.FileWhereInput,
  ): Promise<DownloadableSubmissionFile | null> {
    const file = await this.prisma.file.findFirst({
      where,
      select: {
        id: true,
        storageKey: true,
        originalFileName: true,
        mimeType: true,
        sizeBytes: true,
        expiresAt: true,
      },
    });
    if (file?.expiresAt === null || file === null) return null;
    return { ...this.fileMetadata.read(file), expiresAt: file.expiresAt };
  }
}
function downloadableFileWhere(
  fileId: string,
  now: Date,
): Prisma.FileWhereInput {
  return {
    id: fileId,
    lifecycle: FileLifecycle.ATTACHED,
    kind: 'SUBMISSION',
    submissionHistoryId: { not: null },
    expiresAt: { gt: now },
  };
}

export interface StorageReferenceRepository {
  readonly loadLiveKeys: () => Promise<ReadonlySet<string>>;
  readonly isLiveKey: (key: string) => Promise<boolean>;
}
export interface StorageReferenceTransactionClient {
  readonly file: {
    findMany(input: {
      readonly where: Prisma.FileWhereInput;
      readonly select: { readonly storageKey: true };
    }): Promise<readonly { readonly storageKey: string }[]>;
    findFirst(input: {
      readonly where: Prisma.FileWhereInput;
      readonly select: { readonly id: true };
    }): Promise<{ readonly id: string } | null>;
  };
}
export interface StorageReferencePrisma {
  $connect(): Promise<void>;
  $transaction<T>(
    operation: (transaction: StorageReferenceTransactionClient) => Promise<T>,
    options: { readonly isolationLevel: Prisma.TransactionIsolationLevel },
  ): Promise<T>;
}
@Injectable()
export class PrismaStorageReferenceRepository implements StorageReferenceRepository {
  constructor(private readonly prisma: StorageReferencePrisma) {}
  async loadLiveKeys(): Promise<ReadonlySet<string>> {
    await this.prisma.$connect();
    return this.prisma.$transaction(
      async (transaction) => {
        const files = await transaction.file.findMany({
          where: { lifecycle: { not: 'DELETED' } },
          select: { storageKey: true },
        });
        return new Set(files.map((file) => file.storageKey));
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  isLiveKey(key: string): Promise<boolean> {
    return this.prisma.$transaction(
      async (transaction) => {
        const file = await transaction.file.findFirst({
          where: { storageKey: key, lifecycle: { not: 'DELETED' } },
          select: { id: true },
        });
        return file !== null;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}

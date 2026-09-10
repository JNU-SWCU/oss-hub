import {
  Prisma,
  ProgramAuthoringUploadLifecycle,
  ProgramPurgeFileTombstoneLifecycle,
  SubmissionFileLifecycle,
} from '@prisma/client';
import type { StorageReferenceRepository } from './storage-orphan-reconciliation';

type StorageKey = { readonly storageKey: string };
type StorageId = { readonly id: string };

type StorageKeyReader<Where> = {
  findMany(args: {
    readonly where?: Where;
    readonly select: { readonly storageKey: true };
  }): Promise<readonly StorageKey[]>;
};

type StorageIdReader<Where> = {
  findFirst(args: {
    readonly where: Where;
    readonly select: { readonly id: true };
  }): Promise<StorageId | null>;
};

export type StorageReferenceTransactionClient = {
  readonly submissionFile: StorageKeyReader<Prisma.SubmissionFileWhereInput> &
    StorageIdReader<Prisma.SubmissionFileWhereInput>;
  readonly programAuthoringUpload: StorageKeyReader<Prisma.ProgramAuthoringUploadWhereInput> &
    StorageIdReader<Prisma.ProgramAuthoringUploadWhereInput>;
  readonly programCover: StorageKeyReader<Prisma.ProgramCoverWhereInput> &
    StorageIdReader<Prisma.ProgramCoverWhereInput>;
  readonly milestoneDocumentTemplateFile: StorageKeyReader<Prisma.MilestoneDocumentTemplateFileWhereInput> &
    StorageIdReader<Prisma.MilestoneDocumentTemplateFileWhereInput>;
  readonly programPurgeFileTombstone: StorageKeyReader<Prisma.ProgramPurgeFileTombstoneWhereInput> &
    StorageIdReader<Prisma.ProgramPurgeFileTombstoneWhereInput>;
};

export interface StorageReferencePrisma {
  $connect(): Promise<void>;
  $transaction<T>(
    operation: (transaction: StorageReferenceTransactionClient) => Promise<T>,
    options: {
      readonly isolationLevel: Prisma.TransactionIsolationLevel;
    },
  ): Promise<T>;
}

/**
 * schema.prisma의 storageKey 소유 모델 전수 원장.
 * 대응 spec이 Prisma DMMF와 대조하므로 새 소유 모델을 추가하고 여기를 빠뜨리면 실패한다.
 */
export const STORAGE_KEY_OWNERS = [
  'SubmissionFile',
  'ProgramAuthoringUpload',
  'ProgramCover',
  'MilestoneDocumentTemplateFile',
  'ProgramPurgeFileTombstone',
] as const;

export class PrismaStorageReferenceRepository implements StorageReferenceRepository {
  constructor(private readonly prisma: StorageReferencePrisma) {}

  async loadLiveKeys(): Promise<ReadonlySet<string>> {
    await this.prisma.$connect();
    return this.prisma.$transaction(
      async (transaction) => {
        const [
          submissionFiles,
          authoringUploads,
          programCovers,
          templateFiles,
          purgeTombstones,
        ] = await Promise.all([
          transaction.submissionFile.findMany({
            where: { lifecycle: { not: SubmissionFileLifecycle.DELETED } },
            select: { storageKey: true },
          }),
          transaction.programAuthoringUpload.findMany({
            where: {
              lifecycle: { not: ProgramAuthoringUploadLifecycle.DELETED },
            },
            select: { storageKey: true },
          }),
          transaction.programCover.findMany({
            select: { storageKey: true },
          }),
          transaction.milestoneDocumentTemplateFile.findMany({
            select: { storageKey: true },
          }),
          transaction.programPurgeFileTombstone.findMany({
            where: {
              lifecycle: { not: ProgramPurgeFileTombstoneLifecycle.DELETED },
            },
            select: { storageKey: true },
          }),
        ]);

        return new Set(
          [
            ...submissionFiles,
            ...authoringUploads,
            ...programCovers,
            ...templateFiles,
            ...purgeTombstones,
          ].map(({ storageKey }) => storageKey),
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async isLiveKey(key: string): Promise<boolean> {
    return this.prisma.$transaction(
      async (transaction) => {
        const [
          submissionFile,
          authoringUpload,
          programCover,
          templateFile,
          purgeTombstone,
        ] = await Promise.all([
          transaction.submissionFile.findFirst({
            where: {
              storageKey: key,
              lifecycle: { not: SubmissionFileLifecycle.DELETED },
            },
            select: { id: true },
          }),
          transaction.programAuthoringUpload.findFirst({
            where: {
              storageKey: key,
              lifecycle: { not: ProgramAuthoringUploadLifecycle.DELETED },
            },
            select: { id: true },
          }),
          transaction.programCover.findFirst({
            where: { storageKey: key },
            select: { id: true },
          }),
          transaction.milestoneDocumentTemplateFile.findFirst({
            where: { storageKey: key },
            select: { id: true },
          }),
          transaction.programPurgeFileTombstone.findFirst({
            where: {
              storageKey: key,
              lifecycle: { not: ProgramPurgeFileTombstoneLifecycle.DELETED },
            },
            select: { id: true },
          }),
        ]);
        return (
          submissionFile !== null ||
          authoringUpload !== null ||
          programCover !== null ||
          templateFile !== null ||
          purgeTombstone !== null
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}

import {
  PrismaClient,
  ProgramAuthoringUploadLifecycle,
  ProgramPurgeFileTombstoneLifecycle,
  SubmissionFileLifecycle,
} from '@prisma/client';
import type { StorageReferenceRepository } from './storage-orphan-reconciliation';

/**
 * schema.prisma의 storageKey 소유 모델 전수 원장.
 * 대응 spec이 Prisma DMMF와 대조하므로 새 소유 모델을 추가하고 여기를 빠뜨리면 실패한다.
 */
export const STORAGE_KEY_OWNERS = [
  'SubmissionFile',
  'ProgramAuthoringUpload',
  'MilestoneDocumentTemplateFile',
  'ProgramPurgeFileTombstone',
] as const;

export class PrismaStorageReferenceRepository implements StorageReferenceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async loadLiveKeys(): Promise<ReadonlySet<string>> {
    await this.prisma.$connect();
    const [submissionFiles, authoringUploads, templateFiles, purgeTombstones] =
      await Promise.all([
        this.prisma.submissionFile.findMany({
          where: { lifecycle: { not: SubmissionFileLifecycle.DELETED } },
          select: { storageKey: true },
        }),
        this.prisma.programAuthoringUpload.findMany({
          where: {
            lifecycle: { not: ProgramAuthoringUploadLifecycle.DELETED },
          },
          select: { storageKey: true },
        }),
        this.prisma.milestoneDocumentTemplateFile.findMany({
          select: { storageKey: true },
        }),
        this.prisma.programPurgeFileTombstone.findMany({
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
        ...templateFiles,
        ...purgeTombstones,
      ].map(({ storageKey }) => storageKey),
    );
  }

  async isLiveKey(key: string): Promise<boolean> {
    const [submissionFile, authoringUpload, templateFile, purgeTombstone] =
      await Promise.all([
        this.prisma.submissionFile.findFirst({
          where: {
            storageKey: key,
            lifecycle: { not: SubmissionFileLifecycle.DELETED },
          },
          select: { id: true },
        }),
        this.prisma.programAuthoringUpload.findFirst({
          where: {
            storageKey: key,
            lifecycle: { not: ProgramAuthoringUploadLifecycle.DELETED },
          },
          select: { id: true },
        }),
        this.prisma.milestoneDocumentTemplateFile.findFirst({
          where: { storageKey: key },
          select: { id: true },
        }),
        this.prisma.programPurgeFileTombstone.findFirst({
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
      templateFile !== null ||
      purgeTombstone !== null
    );
  }
}

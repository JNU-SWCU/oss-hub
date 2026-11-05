import { FileCleanupRepository } from './files.repository';
import { canonicalUserCreateFromLabel } from '../users/canonical-user-fixture';
import { createHash } from 'node:crypto';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  AccountStatus,
  ProgramAuthoringUploadLifecycle,
  ProgramTrackType,
} from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { S3ObjectStorageClient } from '../platform/s3-object-storage.client';
import { ObjectStorageConfig } from '../platform/object-storage.config';
import { FileCleanupService } from './file-cleanup.service';
import { ProgramAuthoringUploadRepository } from './files.repository';
import {
  type ProgramAuthoringDocumentRequest,
  type ProgramAuthoringMilestoneRequest,
  type ProgramAuthoringRequest,
} from './files.config';

export const AUTHORING_TEST_PREFIX = 'test:p5:authoring:';
const AUTHORING_OBJECT_PREFIX = 'program-authoring/test-p5-authoring';
const AUTHORING_NOW = new Date('2026-08-10T00:00:00.000Z');
const AUTHORING_EXPIRES_AT = new Date('2026-08-11T00:00:00.000Z');

type SeedUploadOptions = {
  readonly actorId: string;
  readonly label: string;
  readonly expiresAt?: Date;
  readonly realObject?: boolean;
};

export class ProgramAuthoringIntegrationHarness {
  readonly prisma = new PrismaService();
  readonly uploads = new ProgramAuthoringUploadRepository(this.prisma);
  readonly storageConfig = new ObjectStorageConfig();
  private readonly settings = this.storageConfig.requireSettings();
  readonly s3 = new S3Client({
    endpoint: this.settings.endpoint,
    region: this.settings.region,
    forcePathStyle: this.settings.forcePathStyle,
    credentials: {
      accessKeyId: this.settings.accessKeyId,
      secretAccessKey: this.settings.secretAccessKey,
    },
  });
  readonly storage = new S3ObjectStorageClient(this.storageConfig, this.s3);
  readonly maintenance = new FileCleanupService(
    new FileCleanupRepository(this.prisma),
    this.storage,
    () => AUTHORING_NOW,
  );

  async start(): Promise<void> {
    await this.prisma.$connect();
    await this.cleanup();
  }

  async stop(): Promise<void> {
    await this.cleanup();
    this.s3.destroy();
    await this.prisma.$disconnect();
  }

  async createActor(
    label: string,
    role: 'STUDENT' | 'STAFF' | 'ADMIN' | null = 'STAFF',
  ): Promise<{ readonly id: string; readonly githubId: bigint }> {
    const ordinal = BigInt(
      [...label].reduce((sum, value) => sum + value.charCodeAt(0), 0),
    );
    return this.prisma.user.create({
      data: canonicalUserCreateFromLabel(role, {
        id: `${AUTHORING_TEST_PREFIX}actor:${label}`,
        githubId: 9_748_000_000_000n + ordinal,
        nickname: `synthetic-p5-${label}`,
        accountStatus: AccountStatus.ACTIVE,
      }),
      select: { id: true, githubId: true },
    });
  }

  async seedUpload(options: SeedUploadOptions): Promise<string> {
    const id = `${AUTHORING_TEST_PREFIX}upload:${options.label}`;
    const storageKey = `${AUTHORING_OBJECT_PREFIX}/${options.label}.pdf`;
    const body = pdfBody(options.label);
    await this.prisma.file.create({
      data: {
        kind: 'UPLOAD',
        id: id,
        uploaderId: options.actorId,
        storageKey: storageKey,
        originalFileName: `${options.label}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: body.byteLength,
        sha256: createHash('sha256').update(body).digest('hex'),
        lifecycle: ProgramAuthoringUploadLifecycle.PENDING,
        pendingExpiresAt: options.expiresAt ?? AUTHORING_EXPIRES_AT,
      },
    });
    if (options.realObject === true) {
      await this.storage.put({
        body,
        contentType: 'application/pdf',
        originalName: `${options.label}.pdf`,
        objectKey: storageKey,
      });
    }
    return id;
  }

  async objectExists(storageKey: string): Promise<boolean> {
    try {
      await this.s3.send(
        new HeadObjectCommand({
          Bucket: this.settings.bucket,
          Key: storageKey,
        }),
      );
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  async cleanup(): Promise<void> {
    await this.prisma.program.updateMany({
      where: { name: { startsWith: AUTHORING_TEST_PREFIX } },
      data: { coverFileId: null },
    });
    const files = await this.prisma.file.findMany({
      where: { uploaderId: { startsWith: AUTHORING_TEST_PREFIX } },
      select: { storageKey: true },
    });
    await Promise.all(
      files.map((file) => this.storage.delete(file.storageKey)),
    );
    await this.prisma.file.deleteMany({
      where: { uploaderId: { startsWith: AUTHORING_TEST_PREFIX } },
    });
    await this.prisma.milestoneDocument.deleteMany({
      where: {
        milestone: { program: { name: { startsWith: AUTHORING_TEST_PREFIX } } },
      },
    });
    await this.prisma.milestone.deleteMany({
      where: { program: { name: { startsWith: AUTHORING_TEST_PREFIX } } },
    });
    await this.prisma.program.deleteMany({
      where: { name: { startsWith: AUTHORING_TEST_PREFIX } },
    });
    await this.prisma.admin.deleteMany({
      where: { user: { id: { startsWith: AUTHORING_TEST_PREFIX } } },
    });
    await this.prisma.user.deleteMany({
      where: { id: { startsWith: AUTHORING_TEST_PREFIX } },
    });
  }
}

export function authoringRequest(
  label: string,
  milestones: readonly ProgramAuthoringMilestoneRequest[],
): ProgramAuthoringRequest {
  return {
    name: `${AUTHORING_TEST_PREFIX}program:${label}`,
    organizer: 'Synthetic OSS Center',
    trackType: ProgramTrackType.CURRICULAR,
    applicationStartAt: '2026-08-01T00:00:00.000Z',
    applicationEndAt: '2026-08-05T00:00:00.000Z',
    startAt: '2026-08-06T00:00:00.000Z',
    endAt: '2026-09-30T00:00:00.000Z',
    teamMinSize: 1,
    teamMaxSize: 4,
    description: `Synthetic aggregate ${label}`,
    repositoryProvisioningEnabled: true,
    notifyOnDeadline: false,
    milestones,
  };
}

export function authoringMilestone(
  label: string,
  documents: readonly ProgramAuthoringDocumentRequest[],
): ProgramAuthoringMilestoneRequest {
  return {
    name: `${AUTHORING_TEST_PREFIX}milestone:${label}`,
    startAt: '2026-08-06T00:00:00.000Z',
    dueAt: '2026-09-01T00:00:00.000Z',
    instructions: `Synthetic instructions ${label}`,
    documents,
  };
}

export function authoringDocument(
  label: string,
  templateUploadId?: string,
): ProgramAuthoringDocumentRequest {
  return {
    name: `${AUTHORING_TEST_PREFIX}document:${label}`,
    required: true,
    ...(templateUploadId === undefined ? {} : { templateUploadId }),
  };
}

function pdfBody(label: string, size = 64): Buffer {
  const body = Buffer.alloc(size);
  Buffer.from(`%PDF-${label}`).copy(body);
  return body;
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  return (
    '$metadata' in error &&
    typeof error.$metadata === 'object' &&
    error.$metadata !== null &&
    'httpStatusCode' in error.$metadata &&
    error.$metadata.httpStatusCode === 404
  );
}

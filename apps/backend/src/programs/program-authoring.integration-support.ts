import { authorityFactsFor } from '../users/canonical-user-fixture';
import { createHash } from 'node:crypto';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  AccountStatus,
  MilestoneSubmissionType,
  ProgramAuthoringUploadLifecycle,
  ProgramCategory,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { S3SubmissionFileStorage } from '../submissions/s3-submission-file.storage';
import { SubmissionFileStorageConfig } from '../submissions/submission-file-storage.config';
import { ProgramAuthoringUploadMaintenanceService } from './program-authoring-upload-maintenance.service';
import { ProgramAuthoringUploadRepository } from './program-authoring-upload.repository';
import type {
  ProgramAuthoringDocumentRequest,
  ProgramAuthoringMilestoneRequest,
  ProgramAuthoringRequest,
} from './program-authoring.types';

export const AUTHORING_TEST_PREFIX = 'test:p5:authoring:';
export const AUTHORING_OBJECT_PREFIX = 'program-authoring/test-p5-authoring';
export const AUTHORING_NOW = new Date('2026-08-10T00:00:00.000Z');
export const AUTHORING_EXPIRES_AT = new Date('2026-08-11T00:00:00.000Z');
export const AUTHORING_ALLOWED_ORIGIN = 'http://program-authoring.test';

type SeedUploadOptions = {
  readonly actorId: string;
  readonly label: string;
  readonly expiresAt?: Date;
  readonly realObject?: boolean;
};

export class ProgramAuthoringIntegrationHarness {
  readonly prisma = new PrismaService();
  readonly uploads = new ProgramAuthoringUploadRepository(this.prisma);
  readonly storageConfig = new SubmissionFileStorageConfig();
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
  readonly storage = new S3SubmissionFileStorage(this.storageConfig, this.s3);
  readonly maintenance = new ProgramAuthoringUploadMaintenanceService(
    this.uploads,
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
      data: {
        id: `${AUTHORING_TEST_PREFIX}actor:${label}`,
        githubId: 9_748_000_000_000n + ordinal,
        nickname: `synthetic-p5-${label}`,
        ...authorityFactsFor(role),
        accountStatus: AccountStatus.ACTIVE,
      },
      select: { id: true, githubId: true },
    });
  }

  async seedUpload(options: SeedUploadOptions): Promise<string> {
    const id = `${AUTHORING_TEST_PREFIX}upload:${options.label}`;
    const storageKey = `${AUTHORING_OBJECT_PREFIX}/${options.label}.pdf`;
    const body = pdfBody(options.label);
    await this.prisma.programAuthoringUpload.create({
      data: {
        id,
        actorId: options.actorId,
        storageKey,
        originalFileName: `${options.label}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: body.byteLength,
        sha256: createHash('sha256').update(body).digest('hex'),
        lifecycle: ProgramAuthoringUploadLifecycle.PENDING,
        expiresAt: options.expiresAt ?? AUTHORING_EXPIRES_AT,
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
    const uploads = await this.prisma.programAuthoringUpload.findMany({
      where: {
        OR: [
          { actorId: { startsWith: AUTHORING_TEST_PREFIX } },
          { storageKey: { startsWith: AUTHORING_OBJECT_PREFIX } },
        ],
      },
      select: { storageKey: true },
    });
    await Promise.all(
      uploads.map(({ storageKey }) => this.storage.delete(storageKey)),
    );
    await this.prisma.programAuthoringUpload.deleteMany({
      where: { actorId: { startsWith: AUTHORING_TEST_PREFIX } },
    });
    await this.prisma.milestoneDocumentTemplateFile.deleteMany({
      where: {
        milestoneDocument: {
          milestone: {
            program: { name: { startsWith: AUTHORING_TEST_PREFIX } },
          },
        },
      },
    });
    await this.prisma.milestoneDocument.deleteMany({
      where: {
        milestone: { program: { name: { startsWith: AUTHORING_TEST_PREFIX } } },
      },
    });
    await this.prisma.milestone.deleteMany({
      where: { program: { name: { startsWith: AUTHORING_TEST_PREFIX } } },
    });
    await this.prisma.programCreateRequest.deleteMany({
      where: { actorId: { startsWith: AUTHORING_TEST_PREFIX } },
    });
    await this.prisma.program.deleteMany({
      where: { name: { startsWith: AUTHORING_TEST_PREFIX } },
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
    category: ProgramCategory.CAPSTONE,
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
    submissionType: MilestoneSubmissionType.FILE,
    ...(templateUploadId === undefined ? {} : { templateUploadId }),
  };
}

export function pdfBody(label: string, size = 64): Buffer {
  const body = Buffer.alloc(size);
  Buffer.from(`%PDF-${label}`).copy(body);
  return body;
}

export async function runTogether<T>(
  operations: readonly (() => Promise<T>)[],
): Promise<readonly PromiseSettledResult<T>[]> {
  let release: (() => void) | undefined;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const results = operations.map((operation) => barrier.then(operation));
  if (release === undefined)
    throw new Error('Concurrent barrier was not initialized');
  release();
  return Promise.allSettled(results);
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

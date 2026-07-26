import { Inject, Injectable } from '@nestjs/common';
import { MilestoneSubmissionType } from '@prisma/client';
import { DomainException } from '../common/error-code';
import {
  createSubmissionFileObjectKey,
  sanitizeSubmissionFileOriginalName,
} from './submission-file-name';
import {
  SUBMISSION_FILE_STORAGE,
  type SubmissionFileStoragePort,
} from './submission-file-storage.port';
import {
  type CreatePendingSubmissionFileInput,
  SubmissionFileRetentionUnavailableError,
  SubmissionFilesRepository,
} from './submission-files.repository';
import {
  SUBMISSIONS_ERROR_CODES,
  SubmissionsErrorCode,
} from './submissions-error-code.enum';

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

const ALLOWED_FILE_TYPES: Readonly<Record<string, readonly string[]>> = {
  '.pdf': ['application/pdf'],
  '.hwp': ['application/x-hwp'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png': ['image/png'],
  '.zip': ['application/zip'],
};

export interface SubmissionFileUpload {
  readonly buffer: Buffer;
  readonly originalname: string;
  readonly mimetype: string;
  readonly size: number;
}

export interface UploadedSubmissionFileResponse {
  readonly fileId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly size: number;
  readonly expiresAt: string;
}

@Injectable()
export class SubmissionFilesService {
  constructor(
    private readonly repository: SubmissionFilesRepository,
    @Inject(SUBMISSION_FILE_STORAGE)
    private readonly storage: SubmissionFileStoragePort,
  ) {}

  async upload(
    sessionGithubId: bigint,
    applicationId: unknown,
    milestoneId: unknown,
    file: SubmissionFileUpload | undefined,
  ): Promise<UploadedSubmissionFileResponse> {
    const normalizedApplicationId = this.requiredOpaqueId(applicationId);
    const normalizedMilestoneId = this.requiredOpaqueId(milestoneId);
    if (file === undefined || !Buffer.isBuffer(file.buffer)) {
      throw this.error(SubmissionsErrorCode.INVALID_FILE_UPLOAD);
    }
    if (file.size > MAX_FILE_BYTES || file.buffer.byteLength > MAX_FILE_BYTES) {
      throw this.error(SubmissionsErrorCode.FILE_TOO_LARGE);
    }
    if (
      !isAllowedFile(file.originalname, file.mimetype) ||
      !hasValidFileSignature(file.buffer, file.originalname)
    ) {
      throw this.error(SubmissionsErrorCode.UNSUPPORTED_FILE_TYPE);
    }

    const uploaderId =
      await this.repository.findActiveStudentByGithubId(sessionGithubId);
    if (uploaderId === null) {
      throw this.error(SubmissionsErrorCode.STUDENT_ONLY);
    }
    const authorization = await this.repository.findUploadAuthorization(
      uploaderId,
      normalizedApplicationId,
      normalizedMilestoneId,
    );
    if (authorization === null) {
      throw this.error(SubmissionsErrorCode.NOT_APPLICATION_MEMBER);
    }
    if (!authorization.applicationApproved) {
      throw this.error(SubmissionsErrorCode.APPLICATION_APPROVAL_REQUIRED);
    }
    if (authorization.submissionType !== MilestoneSubmissionType.FILE) {
      throw this.error(SubmissionsErrorCode.CONTENT_TYPE_MISMATCH);
    }

    const now = new Date();
    if (authorization.dueAt.getTime() <= now.getTime()) {
      throw this.error(SubmissionsErrorCode.MILESTONE_CLOSED);
    }
    if (authorization.programEndAt === null) {
      throw this.error(SubmissionsErrorCode.FILE_RETENTION_UNAVAILABLE);
    }

    const objectKey = createSubmissionFileObjectKey();
    const originalName = sanitizeSubmissionFileOriginalName(file.originalname);
    const pendingInput: CreatePendingSubmissionFileInput = {
      uploaderId,
      applicationId: normalizedApplicationId,
      milestoneId: normalizedMilestoneId,
      storageKey: objectKey,
      originalFileName: originalName,
      mimeType: file.mimetype,
      sizeBytes: file.buffer.byteLength,
      pendingExpiresAt: new Date(now.getTime() + PENDING_TTL_MS),
    };

    let created;
    try {
      created = await this.repository.createPending(pendingInput);
    } catch (error) {
      if (error instanceof SubmissionFileRetentionUnavailableError) {
        throw this.error(SubmissionsErrorCode.FILE_RETENTION_UNAVAILABLE);
      }
      throw this.error(SubmissionsErrorCode.FILE_STORAGE_UNAVAILABLE);
    }

    try {
      await this.storage.put({
        body: file.buffer,
        contentType: file.mimetype,
        originalName,
        objectKey,
      });
    } catch {
      throw this.error(SubmissionsErrorCode.FILE_STORAGE_UNAVAILABLE);
    }

    return {
      fileId: created.id,
      fileName: created.originalFileName,
      contentType: created.mimeType,
      size: created.sizeBytes,
      expiresAt: created.expiresAt!.toISOString(),
    };
  }

  private requiredOpaqueId(value: unknown): string {
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      value !== value.trim()
    ) {
      throw this.error(SubmissionsErrorCode.INVALID_FILE_UPLOAD);
    }
    return value;
  }

  private error(code: SubmissionsErrorCode): DomainException {
    return new DomainException(SUBMISSIONS_ERROR_CODES[code]);
  }
}

function hasValidFileSignature(buffer: Buffer, fileName: string): boolean {
  const extension = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
  const signatures: Readonly<Record<string, readonly Buffer[]>> = {
    '.pdf': [Buffer.from('%PDF-')],
    '.hwp': [Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])],
    '.jpg': [Buffer.from([0xff, 0xd8, 0xff])],
    '.jpeg': [Buffer.from([0xff, 0xd8, 0xff])],
    '.png': [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    '.zip': [
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from([0x50, 0x4b, 0x05, 0x06]),
      Buffer.from([0x50, 0x4b, 0x07, 0x08]),
    ],
  };
  return (
    signatures[extension]?.some(
      (signature) =>
        buffer.length >= signature.length &&
        buffer.subarray(0, signature.length).equals(signature),
    ) ?? false
  );
}

function isAllowedFile(fileName: string, mimeType: string): boolean {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) return false;
  const extension = fileName.slice(dot).toLowerCase();
  return (
    ALLOWED_FILE_TYPES[extension]?.includes(mimeType.toLowerCase()) ?? false
  );
}

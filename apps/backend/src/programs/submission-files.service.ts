import { Inject, Injectable } from '@nestjs/common';
import { MilestoneSubmissionType, SubmissionStatus } from '@prisma/client';
import type { Readable } from 'node:stream';
import { DomainException } from '../platform/error-code.error';
import { type ObjectStoragePort } from '../platform/object-storage.types';
import {
  OBJECT_STORAGE_ERROR_CODES,
  ObjectStorageError,
} from '../platform/object-storage.error';
import { OBJECT_STORAGE } from '../platform/object-storage.config';
import { SubmissionMembershipChangedError } from './submission-membership-changed.error';
import {
  SubmissionFileQuotaExceededError,
  SubmissionFileRetentionUnavailableError,
} from './submission-file.error';
import {
  type CreatePendingSubmissionFileInput,
  type SubmissionFileResubmissionContext,
  SubmissionFilesRepository,
} from './submission-files.repository';
import {
  SUBMISSION_ZIP_REJECTION_ERROR_CODES,
  SUBMISSIONS_ERROR_CODES,
  SubmissionsErrorCode,
} from './submissions-error-code.error';
import {
  SubmissionZipRejection,
  MAX_ENTRY_COUNT,
  MAX_TOTAL_UNCOMPRESSED_BYTES,
  MAX_ENTRY_UNCOMPRESSED_BYTES,
} from './submission-zip.error';
import { fromBufferPromise, type Entry } from 'yauzl';
import { normalizeMultipartFileName } from '../platform/multipart-file-upload.interceptor';
import { hasProgramDeadlinePassed } from './programs.service';
import {
  safeSubmissionFileContentType,
  isAllowedSubmissionFileType,
  createSubmissionFileObjectKey,
  sanitizeSubmissionFileOriginalName,
  hasValidSubmissionFileSignature,
} from './submission-file.config';
import { SUBMISSION_UPLOAD_MAX_BYTES } from './submission-upload.config';

const MAX_COMPRESSION_RATIO = 100;

const UNIX_HOST_SYSTEM = 3;

const UNIX_FILE_TYPE_MASK = 0xf000;

const UNIX_SYMLINK_TYPE = 0xa000;

export async function inspectSubmissionZipMetadata(
  buffer: Buffer,
): Promise<SubmissionZipRejection | null> {
  try {
    const zipFile = await fromBufferPromise(buffer, {
      decodeStrings: true,
      strictFileNames: true,
      validateEntrySizes: true,
    });
    if (zipFile.entryCount > MAX_ENTRY_COUNT) {
      return SubmissionZipRejection.TOO_MANY_ENTRIES;
    }

    let entryCount = 0;
    let totalCompressedBytes = 0;
    let totalUncompressedBytes = 0;
    for await (const entry of zipFile.eachEntry()) {
      entryCount += 1;
      const entryRejection = inspectEntry(entry);
      if (entryRejection !== null) return entryRejection;

      totalCompressedBytes += entry.compressedSize;
      totalUncompressedBytes += entry.uncompressedSize;
      if (totalUncompressedBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
        return SubmissionZipRejection.CONTENT_TOO_LARGE;
      }
      if (
        exceedsCompressionRatio(totalUncompressedBytes, totalCompressedBytes)
      ) {
        return SubmissionZipRejection.EXPANDS_TOO_MUCH;
      }
    }

    return entryCount === zipFile.entryCount
      ? null
      : SubmissionZipRejection.UNREADABLE;
  } catch {
    return SubmissionZipRejection.UNREADABLE;
  }
}

function inspectEntry(entry: Entry): SubmissionZipRejection | null {
  const fileName = entry.fileName.toLowerCase();
  if (entry.fileName.includes('\u0000')) {
    return SubmissionZipRejection.ENTRY_NOT_ALLOWED;
  }
  if (fileName.endsWith('.zip')) return SubmissionZipRejection.NESTED_ARCHIVE;
  if (isUnixSymlink(entry)) return SubmissionZipRejection.ENTRY_NOT_ALLOWED;
  if (entry.isEncrypted()) return SubmissionZipRejection.PASSWORD_PROTECTED;
  if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
    return SubmissionZipRejection.UNSUPPORTED_COMPRESSION;
  }
  if (entry.uncompressedSize > MAX_ENTRY_UNCOMPRESSED_BYTES) {
    return SubmissionZipRejection.CONTENT_TOO_LARGE;
  }
  if (exceedsCompressionRatio(entry.uncompressedSize, entry.compressedSize)) {
    return SubmissionZipRejection.EXPANDS_TOO_MUCH;
  }
  return null;
}

function isUnixSymlink(entry: Entry): boolean {
  const hostSystem = entry.versionMadeBy >>> 8;
  const unixFileType =
    (entry.externalFileAttributes >>> 16) & UNIX_FILE_TYPE_MASK;
  return hostSystem === UNIX_HOST_SYSTEM && unixFileType === UNIX_SYMLINK_TYPE;
}

function exceedsCompressionRatio(
  uncompressedBytes: number,
  compressedBytes: number,
): boolean {
  return uncompressedBytes > compressedBytes * MAX_COMPRESSION_RATIO;
}

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

export interface DownloadedSubmissionFile {
  readonly body: Readable;
  readonly fileName: string;
  readonly contentType: string;
  readonly contentLength: number;
}

export const MAX_FILE_BYTES = SUBMISSION_UPLOAD_MAX_BYTES;
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class SubmissionFilesService {
  constructor(
    private readonly repository: SubmissionFilesRepository,
    @Inject(OBJECT_STORAGE)
    private readonly storage: ObjectStoragePort,
  ) {}

  createPending(input: CreatePendingSubmissionFileInput) {
    return this.repository.createPending(input);
  }

  async upload(
    sessionGithubId: bigint,
    applicationId: unknown,
    milestoneId: unknown,
    file: SubmissionFileUpload | undefined,
    submissionId?: unknown,
    baseRevision?: unknown,
  ): Promise<UploadedSubmissionFileResponse> {
    const normalizedApplicationId = this.requiredOpaqueId(applicationId);
    const normalizedMilestoneId = this.requiredOpaqueId(milestoneId);
    const resubmissionContext = this.optionalResubmissionContext(
      submissionId,
      baseRevision,
    );
    if (file === undefined || !Buffer.isBuffer(file.buffer)) {
      throw this.error(SubmissionsErrorCode.INVALID_FILE_UPLOAD);
    }
    const normalizedFileName = await this.admitFile(file);

    const uploaderId =
      await this.repository.findActiveStudentByGithubId(sessionGithubId);
    if (uploaderId === null) {
      throw this.error(SubmissionsErrorCode.STUDENT_ONLY);
    }
    const authorization = await this.repository.findUploadAuthorization(
      uploaderId,
      normalizedApplicationId,
      normalizedMilestoneId,
      resubmissionContext,
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
    if (resubmissionContext !== null) {
      const status = authorization.resubmissionStatus;
      const replaceableBeforeDue =
        status === SubmissionStatus.SUBMITTED &&
        !hasProgramDeadlinePassed(authorization.dueAt, now);
      if (
        status !== SubmissionStatus.CHANGES_REQUESTED &&
        !replaceableBeforeDue
      ) {
        throw this.error(SubmissionsErrorCode.RESUBMISSION_NOT_ALLOWED);
      }
      if (authorization.currentRevision !== resubmissionContext.baseRevision) {
        throw this.error(SubmissionsErrorCode.STALE_SUBMISSION_REVISION);
      }
    }

    if (
      resubmissionContext === null &&
      hasProgramDeadlinePassed(authorization.dueAt, now)
    ) {
      throw this.error(SubmissionsErrorCode.MILESTONE_CLOSED);
    }
    const objectKey = createSubmissionFileObjectKey();
    const originalName = sanitizeSubmissionFileOriginalName(normalizedFileName);
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
      created = await this.createPending(pendingInput);
    } catch (error) {
      if (error instanceof SubmissionMembershipChangedError) {
        throw this.error(SubmissionsErrorCode.NOT_APPLICATION_MEMBER);
      }
      if (error instanceof SubmissionFileQuotaExceededError) {
        throw this.error(SubmissionsErrorCode.SUBMISSION_FILE_QUOTA_EXCEEDED);
      }
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

  async check(file: SubmissionFileUpload | undefined): Promise<void> {
    if (file === undefined || !Buffer.isBuffer(file.buffer)) {
      throw this.error(SubmissionsErrorCode.INVALID_FILE_UPLOAD);
    }
    await this.admitFile(file);
  }

  private async admitFile(file: SubmissionFileUpload): Promise<string> {
    if (file.size > MAX_FILE_BYTES || file.buffer.byteLength > MAX_FILE_BYTES) {
      throw this.error(SubmissionsErrorCode.FILE_TOO_LARGE);
    }
    const normalizedFileName = normalizeMultipartFileName(file.originalname);
    if (
      !isAllowedSubmissionFileType(normalizedFileName) ||
      !hasValidSubmissionFileSignature(file.buffer, normalizedFileName)
    ) {
      throw this.error(SubmissionsErrorCode.UNSUPPORTED_FILE_TYPE);
    }

    if (normalizedFileName.toLowerCase().endsWith('.zip')) {
      const zipRejection = await inspectSubmissionZipMetadata(file.buffer);
      if (zipRejection !== null) {
        throw this.error(SUBMISSION_ZIP_REJECTION_ERROR_CODES[zipRejection]);
      }
    }
    return normalizedFileName;
  }

  async download(
    sessionGithubId: bigint,
    fileId: string,
    now: Date = new Date(),
  ): Promise<DownloadedSubmissionFile> {
    if (fileId.length === 0 || fileId !== fileId.trim()) {
      throw this.error(SubmissionsErrorCode.SUBMISSION_FILE_NOT_FOUND);
    }
    const file = await this.repository.findDownloadableFile(
      sessionGithubId,
      fileId,
      now,
    );
    if (file === null) {
      throw this.error(SubmissionsErrorCode.SUBMISSION_FILE_NOT_FOUND);
    }

    let body: Readable;
    try {
      body = await this.storage.get(file.storageKey);
    } catch (error) {
      if (
        error instanceof ObjectStorageError &&
        error.code === OBJECT_STORAGE_ERROR_CODES.GET_NOT_FOUND
      ) {
        throw this.error(SubmissionsErrorCode.SUBMISSION_FILE_NOT_FOUND);
      }
      throw this.error(SubmissionsErrorCode.FILE_STORAGE_UNAVAILABLE);
    }

    return {
      body,
      fileName: file.originalFileName,
      contentType: safeSubmissionFileContentType(file.originalFileName),
      contentLength: file.sizeBytes,
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

  private optionalResubmissionContext(
    submissionId: unknown,
    baseRevision: unknown,
  ): SubmissionFileResubmissionContext | null {
    if (submissionId === undefined && baseRevision === undefined) {
      return null;
    }
    return {
      submissionId: this.requiredOpaqueId(submissionId),
      baseRevision: this.requiredPositiveInteger(baseRevision),
    };
  }

  private requiredPositiveInteger(value: unknown): number {
    if (typeof value === 'number') {
      if (Number.isSafeInteger(value) && value >= 1) return value;
      throw this.error(SubmissionsErrorCode.INVALID_FILE_UPLOAD);
    }
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      value !== value.trim() ||
      !/^[1-9]\d*$/.test(value)
    ) {
      throw this.error(SubmissionsErrorCode.INVALID_FILE_UPLOAD);
    }
    const numericValue = Number(value);
    if (!Number.isSafeInteger(numericValue)) {
      throw this.error(SubmissionsErrorCode.INVALID_FILE_UPLOAD);
    }
    return numericValue;
  }

  private error(code: SubmissionsErrorCode): DomainException {
    return new DomainException(SUBMISSIONS_ERROR_CODES[code]);
  }
}

import type { Response } from 'express';
import { DownloadResponseService } from './download-response.service';
import { Inject, Injectable, StreamableFile } from '@nestjs/common';
import { MilestoneSubmissionType, SubmissionStatus } from '@prisma/client';
import type { Readable } from 'node:stream';
import { DomainException } from '../platform/error-code.error';
import type { ObjectStoragePort } from '../platform/object-storage.types';
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
import { SUBMISSION_UPLOAD_MAX_BYTES } from './submission-upload.config';
import { ProgramScheduleService } from './program-schedule.service';
import { SubmissionFileAdmissionService } from './submission-file-admission.service';

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
    private readonly programScheduleService: ProgramScheduleService,
    private readonly submissionFileAdmissionService: SubmissionFileAdmissionService,
    private readonly downloadResponseService: DownloadResponseService,
  ) {}

  async downloadTo(
    response: Response,
    sessionGithubId: bigint,
    fileId: string,
  ): Promise<StreamableFile> {
    const file = await this.download(sessionGithubId, fileId);
    response.setHeader('Cache-Control', 'private, no-store');
    return this.downloadResponseService.streamableFile(response, file);
  }

  createPending(
    input: Omit<CreatePendingSubmissionFileInput, 'resolveExpiresAt'>,
  ) {
    return this.repository.createPending({
      ...input,
      resolveExpiresAt: (programEndAt) =>
        this.programScheduleService.addOneCalendarYear(programEndAt),
    });
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
        !this.programScheduleService.hasProgramDeadlinePassed(
          authorization.dueAt,
          now,
        );
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
      this.programScheduleService.hasProgramDeadlinePassed(
        authorization.dueAt,
        now,
      )
    ) {
      throw this.error(SubmissionsErrorCode.MILESTONE_CLOSED);
    }
    const objectKey =
      this.submissionFileAdmissionService.createSubmissionFileObjectKey();
    const originalName =
      this.submissionFileAdmissionService.sanitizeSubmissionFileOriginalName(
        normalizedFileName,
      );
    const pendingInput: Omit<
      CreatePendingSubmissionFileInput,
      'resolveExpiresAt'
    > = {
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
    const normalizedFileName =
      this.submissionFileAdmissionService.normalizeMultipartFileName(
        file.originalname,
      );
    if (
      !this.submissionFileAdmissionService.isAllowedSubmissionFileType(
        normalizedFileName,
      ) ||
      !this.submissionFileAdmissionService.hasValidSubmissionFileSignature(
        file.buffer,
        normalizedFileName,
      )
    ) {
      throw this.error(SubmissionsErrorCode.UNSUPPORTED_FILE_TYPE);
    }

    if (normalizedFileName.toLowerCase().endsWith('.zip')) {
      const zipRejection =
        await this.submissionFileAdmissionService.inspectSubmissionZipMetadata(
          file.buffer,
        );
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
      contentType:
        this.submissionFileAdmissionService.safeSubmissionFileContentType(
          file.originalFileName,
        ),
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

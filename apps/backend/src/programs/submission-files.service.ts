import type { Response } from 'express';
import { DownloadResponseService } from './download-response.service';
import { Inject, Injectable, StreamableFile } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { DomainException } from '../platform/error-code.error';
import type { ObjectStoragePort } from '../platform/object-storage.types';
import {
  OBJECT_STORAGE_ERROR_CODES,
  ObjectStorageError,
} from '../platform/object-storage.error';
import { OBJECT_STORAGE } from '../platform/object-storage.config';
import {
  type CreatePendingSubmissionFileInput,
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
  private error(code: SubmissionsErrorCode): DomainException {
    return new DomainException(SUBMISSIONS_ERROR_CODES[code]);
  }
}

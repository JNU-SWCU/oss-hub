import {
  SUBMISSION_UPLOAD_MAX_BYTES,
  PROGRAM_COVER_MAX_BYTES,
} from './submission-upload.config';
import {
  ValidatedProgramAuthoringUpload,
  type ProgramExternalCover,
} from './program-authoring-upload-transaction.repository';
import { Injectable } from '@nestjs/common';
import {
  PROGRAM_AUTHORING_UPLOAD_ERROR_CODES,
  ProgramAuthoringUploadError,
  type ProgramAuthoringUploadFile,
} from './program-authoring-upload.error';
import { ProgramAuthoringUploadTokenError } from './program-authoring.error';
import { PROGRAM_COVER_STORAGE_PREFIX } from './program-cover.config';
import { ProgramAuthoringUploadToken } from './program-authoring-upload.config';
import { DomainException } from '../platform/error-code.error';
import { ProgramAuthoringValidationError } from './program-authoring-validation.error';
import { ProgramNoticeFetchClient } from './program-notice-fetch.client';
import { randomUUID, createHash } from 'node:crypto';
import { normalizeMultipartFileName } from '../platform/multipart-file-upload.interceptor';
import { extname } from 'node:path';
import { SubmissionFileRulesService } from './submission-file-rules.service';

@Injectable()
export class ProgramUploadRulesService {
  createProgramAuthoringObjectKey(): string {
    return `program-authoring/${randomUUID()}`;
  }

  async validateProgramAuthoringUpload(
    file: ProgramAuthoringUploadFile | undefined,
  ): Promise<ValidatedProgramAuthoringUpload> {
    if (
      file === undefined ||
      !Buffer.isBuffer(file.buffer) ||
      file.buffer.byteLength === 0 ||
      file.size !== file.buffer.byteLength
    ) {
      throw new ProgramAuthoringUploadError(
        PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.INVALID_FILE,
      );
    }
    if (file.buffer.byteLength > PROGRAM_AUTHORING_UPLOAD_MAX_BYTES) {
      throw new ProgramAuthoringUploadError(
        PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.FILE_TOO_LARGE,
      );
    }

    const originalFileName =
      this.submissionFileRulesService.sanitizeSubmissionFileOriginalName(
        normalizeMultipartFileName(file.originalname),
      );
    if (
      !this.submissionFileRulesService.hasValidSubmissionTemplateSignature(
        file.buffer,
        originalFileName,
      )
    ) {
      throw new ProgramAuthoringUploadError(
        PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.UNSUPPORTED_FILE_TYPE,
      );
    }

    if (
      originalFileName.toLowerCase().endsWith('.zip') &&
      (await this.submissionFileRulesService.inspectSubmissionZipMetadata(
        file.buffer,
      )) !== null
    ) {
      throw new ProgramAuthoringUploadError(
        PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.UNSUPPORTED_FILE_TYPE,
      );
    }

    return {
      body: file.buffer,
      originalFileName,
      mimeType: file.mimetype.toLowerCase(),
      sizeBytes: file.buffer.byteLength,
      sha256: createHash('sha256').update(file.buffer).digest('hex'),
    };
  }

  createProgramCoverObjectKey(): string {
    return `${PROGRAM_COVER_STORAGE_PREFIX}${randomUUID()}`;
  }

  validateProgramCoverUpload(
    file: ProgramAuthoringUploadFile | undefined,
  ): ValidatedProgramAuthoringUpload {
    if (
      file === undefined ||
      !Buffer.isBuffer(file.buffer) ||
      file.buffer.byteLength === 0 ||
      file.size !== file.buffer.byteLength
    ) {
      throw new ProgramAuthoringUploadError(
        PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.INVALID_FILE,
      );
    }
    if (file.size > PROGRAM_COVER_MAX_BYTES) {
      throw new ProgramAuthoringUploadError(
        PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.FILE_TOO_LARGE,
      );
    }
    const originalFileName =
      this.submissionFileRulesService.sanitizeSubmissionFileOriginalName(
        normalizeMultipartFileName(file.originalname),
      );
    const extension = extname(originalFileName).toLowerCase();
    const mimeType =
      extension === '.png'
        ? 'image/png'
        : extension === '.jpg' || extension === '.jpeg'
          ? 'image/jpeg'
          : null;
    if (
      mimeType === null ||
      file.mimetype.toLowerCase() !== mimeType ||
      !this.submissionFileRulesService.hasValidSubmissionTemplateSignature(
        file.buffer,
        originalFileName,
      )
    ) {
      throw new ProgramAuthoringUploadError(
        PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.UNSUPPORTED_FILE_TYPE,
      );
    }
    return {
      body: file.buffer,
      originalFileName,
      mimeType,
      sizeBytes: file.size,
      sha256: createHash('sha256').update(file.buffer).digest('hex'),
    };
  }

  validateProgramCoverChoice(input: {
    readonly coverUploadId?: string | null;
    readonly externalCover?: ProgramExternalCover | null;
  }): ProgramExternalCover | null | undefined {
    if (
      input.coverUploadId !== undefined &&
      input.externalCover !== undefined
    ) {
      throw new ProgramAuthoringValidationError([
        { path: 'externalCover', code: 'CONFLICTING_COVER_CHOICES' },
      ]);
    }
    if (input.externalCover == null) return input.externalCover;
    try {
      const source = this.noticeClient.parseProgramNoticeUrl(
        input.externalCover.sourceUrl,
      );
      const image = this.noticeClient.parseProgramNoticeImageUrl(
        input.externalCover.imageUrl,
        source,
      );
      if (image !== null)
        return { sourceUrl: source.href, imageUrl: image.href };
    } catch (error) {
      if (!(error instanceof DomainException)) throw error;
    }
    throw new ProgramAuthoringValidationError([
      { path: 'externalCover', code: 'INVALID_EXTERNAL_COVER' },
    ]);
  }

  assertProgramTemplateUpload(upload: ProgramAuthoringUploadToken): void {
    if (!upload.storageKey.startsWith('program-authoring/')) {
      throw new ProgramAuthoringUploadTokenError('WRONG_PURPOSE', [upload.id]);
    }
  }

  assertProgramCoverUpload(upload: ProgramAuthoringUploadToken): void {
    if (
      !upload.storageKey.startsWith(PROGRAM_COVER_STORAGE_PREFIX) ||
      !['image/jpeg', 'image/png'].includes(upload.mimeType) ||
      upload.sizeBytes < 1 ||
      upload.sizeBytes > PROGRAM_COVER_MAX_BYTES
    ) {
      throw new ProgramAuthoringUploadTokenError('WRONG_PURPOSE', [upload.id]);
    }
  }

  constructor(
    private readonly submissionFileRulesService: SubmissionFileRulesService,
    private readonly noticeClient: ProgramNoticeFetchClient,
  ) {}
}

export const PROGRAM_AUTHORING_UPLOAD_MAX_BYTES = SUBMISSION_UPLOAD_MAX_BYTES;

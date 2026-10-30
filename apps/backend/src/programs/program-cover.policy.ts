import { randomUUID, createHash } from 'node:crypto';
import { extname } from 'node:path';
import { normalizeMultipartFileName } from '../platform/platform.policy';
import {
  sanitizeSubmissionFileOriginalName,
  hasValidSubmissionTemplateSignature,
  SUBMISSION_UPLOAD_MAX_BYTES,
} from './submission-file.policy';
import {
  PROGRAM_AUTHORING_UPLOAD_ERROR_CODES,
  ProgramAuthoringUploadError,
  type ProgramAuthoringUploadFile,
} from './program-authoring-upload.error';
import {
  type ValidatedProgramAuthoringUpload,
  ProgramAuthoringUploadTokenError,
  type ProgramAuthoringUploadToken,
} from './program-authoring.policy';

export const PROGRAM_COVER_STORAGE_PREFIX = 'program-covers/';

export function createProgramCoverObjectKey(): string {
  return `${PROGRAM_COVER_STORAGE_PREFIX}${randomUUID()}`;
}

export const PROGRAM_COVER_MAX_BYTES = SUBMISSION_UPLOAD_MAX_BYTES;

export function programCoverImageUrl(
  programId: string,
  coverId: string | null | undefined,
  externalImageUrl?: string | null,
): string | null {
  if (externalImageUrl != null) return externalImageUrl;
  return coverId
    ? `/programs/${encodeURIComponent(programId)}/cover/${encodeURIComponent(coverId)}`
    : null;
}

export function validateProgramCoverUpload(
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
  const originalFileName = sanitizeSubmissionFileOriginalName(
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
    !hasValidSubmissionTemplateSignature(file.buffer, originalFileName)
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

export function assertProgramCoverUpload(
  upload: ProgramAuthoringUploadToken,
): void {
  if (
    !upload.storageKey.startsWith(PROGRAM_COVER_STORAGE_PREFIX) ||
    !['image/jpeg', 'image/png'].includes(upload.mimeType) ||
    upload.sizeBytes < 1 ||
    upload.sizeBytes > PROGRAM_COVER_MAX_BYTES
  ) {
    throw new ProgramAuthoringUploadTokenError('WRONG_PURPOSE', [upload.id]);
  }
}

export function assertProgramTemplateUpload(
  upload: ProgramAuthoringUploadToken,
): void {
  if (!upload.storageKey.startsWith('program-authoring/')) {
    throw new ProgramAuthoringUploadTokenError('WRONG_PURPOSE', [upload.id]);
  }
}

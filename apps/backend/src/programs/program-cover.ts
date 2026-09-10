import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { normalizeMultipartFileName } from '../common/multipart-file-name';
import { sanitizeSubmissionFileOriginalName } from '../submissions/submission-file-name';
import { hasValidSubmissionTemplateSignature } from '../submissions/submission-template-file-policy';
import { SUBMISSION_UPLOAD_MAX_BYTES } from '../submissions/submission-upload-policy';
import {
  PROGRAM_AUTHORING_UPLOAD_ERROR_CODES,
  ProgramAuthoringUploadError,
  type ProgramAuthoringUploadFile,
} from './program-authoring-upload.types';
import type { ValidatedProgramAuthoringUpload } from './program-authoring-upload.validation';
import {
  ProgramAuthoringUploadTokenError,
  type ProgramAuthoringUploadToken,
} from './program-authoring.types';

export const PROGRAM_COVER_MAX_BYTES = SUBMISSION_UPLOAD_MAX_BYTES;
export const PROGRAM_COVER_STORAGE_PREFIX = 'program-covers/';

export function programCoverImageUrl(
  programId: string,
  coverId: string | null | undefined,
): string | null {
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

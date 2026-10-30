import { createHash } from 'node:crypto';
import { normalizeMultipartFileName } from '../platform/multipart-file-name.policy';
import { sanitizeSubmissionFileOriginalName } from './submission-file-object-key.policy';
import { hasValidSubmissionTemplateSignature } from './submission-template-file.policy';
import { inspectSubmissionZipMetadata } from './submission-zip-admission.policy';
import { SUBMISSION_UPLOAD_MAX_BYTES } from './submission-upload.policy';
import {
  PROGRAM_AUTHORING_UPLOAD_ERROR_CODES,
  ProgramAuthoringUploadError,
  type ProgramAuthoringUploadFile,
} from './program-authoring-upload.error';

export const PROGRAM_AUTHORING_UPLOAD_MAX_BYTES = SUBMISSION_UPLOAD_MAX_BYTES;

export interface ValidatedProgramAuthoringUpload {
  readonly body: Buffer;
  readonly originalFileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export async function validateProgramAuthoringUpload(
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

  const originalFileName = sanitizeSubmissionFileOriginalName(
    normalizeMultipartFileName(file.originalname),
  );
  if (!hasValidSubmissionTemplateSignature(file.buffer, originalFileName)) {
    throw new ProgramAuthoringUploadError(
      PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.UNSUPPORTED_FILE_TYPE,
    );
  }

  if (
    originalFileName.toLowerCase().endsWith('.zip') &&
    (await inspectSubmissionZipMetadata(file.buffer)) !== null
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

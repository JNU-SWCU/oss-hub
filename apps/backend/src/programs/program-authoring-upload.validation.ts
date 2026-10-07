import { createHash } from 'node:crypto';
import { normalizeMultipartFileName } from '../common/multipart-file-name';
import { sanitizeSubmissionFileOriginalName } from '../submissions/submission-file-name';
import { hasValidSubmissionTemplateSignature } from '../submissions/submission-template-file-policy';
import { inspectSubmissionZipMetadata } from '../submissions/submission-zip-admission';
import { SUBMISSION_UPLOAD_MAX_BYTES } from '../submissions/submission-upload-policy';
import {
  PROGRAM_AUTHORING_UPLOAD_ERROR_CODES,
  ProgramAuthoringUploadError,
  type ProgramAuthoringUploadFile,
} from './program-authoring-upload.types';

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

import { createHash } from 'node:crypto';
import { normalizeMultipartFileName } from '../common/multipart-file-name';
import { isAllowedSubmissionFileType } from '../submissions/submission-file-content-type';
import { sanitizeSubmissionFileOriginalName } from '../submissions/submission-file-name';
import { hasValidSubmissionFileSignature } from '../submissions/submission-file-signature';
import { isSafeSubmissionZipMetadata } from '../submissions/submission-zip-admission';
import {
  PROGRAM_AUTHORING_UPLOAD_ERROR_CODES,
  ProgramAuthoringUploadError,
  type ProgramAuthoringUploadFile,
} from './program-authoring-upload.types';

export const PROGRAM_AUTHORING_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

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
  if (
    !isAllowedSubmissionFileType(originalFileName) ||
    !hasValidSubmissionFileSignature(file.buffer, originalFileName)
  ) {
    throw new ProgramAuthoringUploadError(
      PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.UNSUPPORTED_FILE_TYPE,
    );
  }
  // .zip은 서명만으로 받지 않는다 — 제출물 경로와 같은 중앙 디렉터리 입장 검사를 거친다.
  if (
    originalFileName.toLowerCase().endsWith('.zip') &&
    !(await isSafeSubmissionZipMetadata(file.buffer))
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

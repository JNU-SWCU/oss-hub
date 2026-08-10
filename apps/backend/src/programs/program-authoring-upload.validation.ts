import { createHash } from 'node:crypto';
import { isAllowedSubmissionFileType } from '../submissions/submission-file-content-type';
import { sanitizeSubmissionFileOriginalName } from '../submissions/submission-file-name';
import {
  PROGRAM_AUTHORING_UPLOAD_ERROR_CODES,
  ProgramAuthoringUploadError,
  type ProgramAuthoringUploadFile,
} from './program-authoring-upload.types';

export const PROGRAM_AUTHORING_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

const FILE_SIGNATURES: Readonly<Record<string, readonly Buffer[]>> = {
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

export interface ValidatedProgramAuthoringUpload {
  readonly body: Buffer;
  readonly originalFileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export function validateProgramAuthoringUpload(
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
  if (file.buffer.byteLength > PROGRAM_AUTHORING_UPLOAD_MAX_BYTES) {
    throw new ProgramAuthoringUploadError(
      PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.FILE_TOO_LARGE,
    );
  }

  const originalFileName = sanitizeSubmissionFileOriginalName(
    file.originalname,
  );
  const mimeType = file.mimetype.toLowerCase();
  if (
    !isAllowedSubmissionFileType(originalFileName, mimeType) ||
    !hasValidSignature(file.buffer, originalFileName)
  ) {
    throw new ProgramAuthoringUploadError(
      PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.UNSUPPORTED_FILE_TYPE,
    );
  }

  return {
    body: file.buffer,
    originalFileName,
    mimeType,
    sizeBytes: file.buffer.byteLength,
    sha256: createHash('sha256').update(file.buffer).digest('hex'),
  };
}

function hasValidSignature(buffer: Buffer, fileName: string): boolean {
  const extension = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
  return (
    FILE_SIGNATURES[extension]?.some(
      (signature) =>
        buffer.byteLength >= signature.byteLength &&
        buffer.subarray(0, signature.byteLength).equals(signature),
    ) ?? false
  );
}

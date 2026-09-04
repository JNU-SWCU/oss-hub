import { createHash } from 'node:crypto';
import { normalizeMultipartFileName } from '../common/multipart-file-name';
import { isAllowedSubmissionFileType } from '../submissions/submission-file-content-type';
import { sanitizeSubmissionFileOriginalName } from '../submissions/submission-file-name';
import { hasValidSubmissionFileSignature } from '../submissions/submission-file-signature';
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
  if (
    !isAllowedSubmissionFileType(originalFileName) ||
    !hasValidSubmissionFileSignature(file.buffer, originalFileName)
  ) {
    throw new ProgramAuthoringUploadError(
      PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.UNSUPPORTED_FILE_TYPE,
    );
  }
  // .zip은 서명만으로 받지 않는다 — 제출물 경로와 같은 중앙 디렉터리 입장 검사를 거친다.
  // 이 경로는 교직원의 프로그램 작성 업로드이고 학생 제출 화면이 아니라, #1108의 갈래별
  // 안내 범위 밖이다. 거절 사유를 코드로 가르지 않고 지금 판정을 그대로 유지한다.
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

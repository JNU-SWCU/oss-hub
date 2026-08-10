export const PROGRAM_AUTHORING_UPLOAD_ERROR_CODES = {
  INVALID_ACTOR: 'PROGRAM_AUTHORING_UPLOAD_INVALID_ACTOR',
  INVALID_FILE: 'PROGRAM_AUTHORING_UPLOAD_INVALID_FILE',
  FILE_TOO_LARGE: 'PROGRAM_AUTHORING_UPLOAD_FILE_TOO_LARGE',
  UNSUPPORTED_FILE_TYPE: 'PROGRAM_AUTHORING_UPLOAD_UNSUPPORTED_FILE_TYPE',
  STORAGE_UNAVAILABLE: 'PROGRAM_AUTHORING_UPLOAD_STORAGE_UNAVAILABLE',
  NOT_FOUND: 'PROGRAM_AUTHORING_UPLOAD_NOT_FOUND',
  ATTACHED_CONFLICT: 'PROGRAM_AUTHORING_UPLOAD_ATTACHED_CONFLICT',
} as const;

export type ProgramAuthoringUploadErrorCode =
  (typeof PROGRAM_AUTHORING_UPLOAD_ERROR_CODES)[keyof typeof PROGRAM_AUTHORING_UPLOAD_ERROR_CODES];

export class ProgramAuthoringUploadError extends Error {
  override readonly name = 'ProgramAuthoringUploadError';

  constructor(readonly code: ProgramAuthoringUploadErrorCode) {
    super(code);
  }
}

export interface ProgramAuthoringUploadFile {
  readonly buffer: Buffer;
  readonly originalname: string;
  readonly mimetype: string;
  readonly size: number;
}

export interface ProgramAuthoringUploadResponse {
  readonly id: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly size: number;
  readonly expiresAt: string;
}

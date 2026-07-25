export const SUBMISSION_FILE_STORAGE = Symbol('SUBMISSION_FILE_STORAGE');

export interface StoreSubmissionFileInput {
  body: Buffer;
  contentType: string;
  originalName: string;
  objectKey?: string;
}

export interface StoredSubmissionFile {
  objectKey: string;
  originalName: string;
  contentLength: number;
  contentType: string;
}

export interface SubmissionFileStoragePort {
  put(input: StoreSubmissionFileInput): Promise<StoredSubmissionFile>;
  delete(objectKey: string): Promise<void>;
}

export const SUBMISSION_FILE_STORAGE_ERROR_CODES = {
  CONFIGURATION: 'SUBMISSION_FILE_STORAGE_CONFIGURATION',
  PUT_FAILED: 'SUBMISSION_FILE_STORAGE_PUT_FAILED',
  DELETE_FAILED: 'SUBMISSION_FILE_STORAGE_DELETE_FAILED',
} as const;

export type SubmissionFileStorageErrorCode =
  (typeof SUBMISSION_FILE_STORAGE_ERROR_CODES)[keyof typeof SUBMISSION_FILE_STORAGE_ERROR_CODES];

export class SubmissionFileStorageError extends Error {
  override readonly name = 'SubmissionFileStorageError';

  constructor(readonly code: SubmissionFileStorageErrorCode) {
    super(code);
  }
}

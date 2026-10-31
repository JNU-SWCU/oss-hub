export const OBJECT_STORAGE_ERROR_CODES = {
  CONFIGURATION: 'SUBMISSION_FILE_STORAGE_CONFIGURATION',
  PUT_FAILED: 'SUBMISSION_FILE_STORAGE_PUT_FAILED',
  GET_NOT_FOUND: 'SUBMISSION_FILE_STORAGE_GET_NOT_FOUND',
  GET_FAILED: 'SUBMISSION_FILE_STORAGE_GET_FAILED',
  LIST_FAILED: 'SUBMISSION_FILE_STORAGE_LIST_FAILED',
  DELETE_FAILED: 'SUBMISSION_FILE_STORAGE_DELETE_FAILED',
} as const;

export type ObjectStorageErrorCode =
  (typeof OBJECT_STORAGE_ERROR_CODES)[keyof typeof OBJECT_STORAGE_ERROR_CODES];

export class ObjectStorageError extends Error {
  override readonly name = 'ObjectStorageError';

  constructor(readonly code: ObjectStorageErrorCode) {
    super(code);
  }
}

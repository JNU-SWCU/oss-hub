import type { Readable } from 'node:stream';

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

export const OBJECT_INVENTORY = Symbol('OBJECT_INVENTORY');

export interface StoreObjectInput {
  body: Buffer;
  contentType: string;
  originalName: string;
  objectKey: string;
}

export interface StoredObject {
  objectKey: string;
  originalName: string;
  contentLength: number;
  contentType: string;
}

export interface ObjectInventoryEntry {
  readonly key: string;
  readonly lastModified: Date;
}

export interface ObjectStoragePort {
  put(input: StoreObjectInput): Promise<StoredObject>;
  get(objectKey: string): Promise<Readable>;
  delete(objectKey: string): Promise<void>;
}

export interface ObjectInventoryPort {
  listObjects(
    prefixes: readonly string[],
  ): Promise<readonly ObjectInventoryEntry[]>;
}

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

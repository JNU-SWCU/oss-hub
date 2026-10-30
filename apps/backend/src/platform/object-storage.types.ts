import type { Response } from 'express';
import type { ErrorCode } from './error-code.error';
import type { Readable } from 'node:stream';

interface DownloadMetadata {
  readonly contentType: string;
  readonly contentLength: number | null;
  readonly fileName: string;
}

export function setDownloadHeaders(
  response: Pick<Response, 'setHeader'>,
  file: DownloadMetadata,
): void {
  response.setHeader('Content-Type', file.contentType);
  if (file.contentLength !== null) {
    response.setHeader('Content-Length', String(file.contentLength));
  }
  response.setHeader(
    'Content-Disposition',
    attachmentDisposition(file.fileName),
  );
}

export function respondWithDownloadFailure(
  response: Response,
  code: ErrorCode,
  afterHeaders: 'END' | 'DESTROY',
): void {
  if (response.destroyed) return;
  if (response.headersSent) {
    if (afterHeaders === 'DESTROY') response.destroy();
    else response.end();
    return;
  }
  response.removeHeader('Content-Length');
  response.removeHeader('Content-Disposition');
  response.status(code.status).contentType('application/problem+json').json({
    type: 'about:blank',
    title: 'Service Unavailable',
    status: code.status,
    detail: code.message,
    instance: response.req.path,
    code: code.code,
  });
}

function attachmentDisposition(fileName: string): string {
  const fallback = [...fileName]
    .map((character) => {
      const code = character.charCodeAt(0);
      if (
        code < 0x20 ||
        code > 0x7e ||
        character === '"' ||
        character === '\\' ||
        character === '/' ||
        character === ';'
      ) {
        return '_';
      }
      return character;
    })
    .join('')
    .trim();
  const asciiFileName = fallback.length > 0 ? fallback : 'file';
  const encodedFileName = encodeURIComponent(fileName).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${asciiFileName}"; filename*=UTF-8''${encodedFileName}`;
}

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

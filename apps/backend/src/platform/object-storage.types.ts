import type { Readable } from 'node:stream';

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

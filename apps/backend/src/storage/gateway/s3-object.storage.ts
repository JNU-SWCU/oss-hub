import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import {
  OBJECT_STORAGE_ERROR_CODES,
  ObjectStorageError,
  type ObjectStoragePort,
  type StoreObjectInput,
  type StoredObject,
} from '../domain/object-storage';
import {
  ObjectS3Connection,
  ObjectStorageConfig,
  S3_OBJECT_CLIENT,
  type ObjectS3Client,
} from '../object-storage.config';

@Injectable()
export class S3ObjectStorage implements ObjectStoragePort {
  private readonly connection: ObjectS3Connection;

  constructor(
    config: ObjectStorageConfig,
    @Optional()
    @Inject(S3_OBJECT_CLIENT)
    client?: ObjectS3Client,
  ) {
    this.connection = new ObjectS3Connection(config, client);
  }

  async put(input: StoreObjectInput): Promise<StoredObject> {
    const { client, bucket } = this.connection.requireClient();

    try {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: input.objectKey,
          Body: input.body,
          ContentLength: input.body.byteLength,
          ContentType: input.contentType,
        }),
      );
    } catch {
      throw new ObjectStorageError(OBJECT_STORAGE_ERROR_CODES.PUT_FAILED);
    }

    return {
      objectKey: input.objectKey,
      originalName: input.originalName,
      contentLength: input.body.byteLength,
      contentType: input.contentType,
    };
  }

  async delete(objectKey: string): Promise<void> {
    const { client, bucket } = this.connection.requireClient();
    try {
      await client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }),
      );
    } catch (error) {
      if (isNotFound(error)) return;
      throw new ObjectStorageError(OBJECT_STORAGE_ERROR_CODES.DELETE_FAILED);
    }
  }

  async get(objectKey: string): Promise<Readable> {
    const { client, bucket } = this.connection.requireClient();
    try {
      const result = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: objectKey }),
      );
      if (
        typeof result === 'object' &&
        result !== null &&
        'Body' in result &&
        result.Body instanceof Readable
      ) {
        return result.Body;
      }
      throw new ObjectStorageError(OBJECT_STORAGE_ERROR_CODES.GET_FAILED);
    } catch (error) {
      throw new ObjectStorageError(
        isNotFound(error)
          ? OBJECT_STORAGE_ERROR_CODES.GET_NOT_FOUND
          : OBJECT_STORAGE_ERROR_CODES.GET_FAILED,
      );
    }
  }
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const providerError = error as {
    name?: unknown;
    Code?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  return (
    providerError.name === 'NoSuchKey' ||
    providerError.name === 'NotFound' ||
    providerError.Code === 'NoSuchKey' ||
    providerError.$metadata?.httpStatusCode === 404
  );
}

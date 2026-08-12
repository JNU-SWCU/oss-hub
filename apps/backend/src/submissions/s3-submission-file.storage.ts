import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import {
  createSubmissionFileObjectKey,
  sanitizeSubmissionFileOriginalName,
} from './submission-file-name';
import { SubmissionFileStorageConfig } from './submission-file-storage.config';
import type { StoredObjectMetadata } from './storage-orphan-reconciliation';
import {
  SUBMISSION_FILE_STORAGE_ERROR_CODES,
  type StoreSubmissionFileInput,
  type StoredSubmissionFile,
  SubmissionFileStorageError,
  type SubmissionFileStoragePort,
} from './submission-file-storage.port';

export const SUBMISSION_FILE_S3_CLIENT = Symbol('SUBMISSION_FILE_S3_CLIENT');

const STORAGE_LIST_REQUEST_TIMEOUT_MS = 30_000;

export interface SubmissionFileS3Client {
  send(
    command:
      | PutObjectCommand
      | GetObjectCommand
      | ListObjectsV2Command
      | DeleteObjectCommand,
    options?: { abortSignal?: AbortSignal },
  ): Promise<unknown>;
}

@Injectable()
export class S3SubmissionFileStorage implements SubmissionFileStoragePort {
  private client: SubmissionFileS3Client | undefined;
  private bucket: string | undefined;

  constructor(
    private readonly config: SubmissionFileStorageConfig,
    @Optional()
    @Inject(SUBMISSION_FILE_S3_CLIENT)
    client?: SubmissionFileS3Client,
  ) {
    this.client = client;
  }

  async put(input: StoreSubmissionFileInput): Promise<StoredSubmissionFile> {
    const { client, bucket } = this.requireClient();
    const objectKey = input.objectKey ?? createSubmissionFileObjectKey();
    const originalName = sanitizeSubmissionFileOriginalName(input.originalName);

    try {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: objectKey,
          Body: input.body,
          ContentLength: input.body.byteLength,
          ContentType: input.contentType,
        }),
      );
    } catch {
      throw new SubmissionFileStorageError(
        SUBMISSION_FILE_STORAGE_ERROR_CODES.PUT_FAILED,
      );
    }

    return {
      objectKey,
      originalName,
      contentLength: input.body.byteLength,
      contentType: input.contentType,
    };
  }

  async listObjects(): Promise<readonly StoredObjectMetadata[]> {
    const { client, bucket } = this.requireClient();
    const objects: StoredObjectMetadata[] = [];
    const seenContinuationTokens = new Set<string>();
    let continuationToken: string | undefined;
    try {
      do {
        const result = (await client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            ContinuationToken: continuationToken,
          }),
          { abortSignal: AbortSignal.timeout(STORAGE_LIST_REQUEST_TIMEOUT_MS) },
        )) as {
          Contents?: Array<{ Key?: string; LastModified?: Date }>;
          IsTruncated?: boolean;
          NextContinuationToken?: string;
        };
        for (const object of result.Contents ?? []) {
          if (!object.Key || object.LastModified === undefined) {
            throw new Error('incomplete storage object metadata');
          }
          objects.push({ key: object.Key, lastModified: object.LastModified });
        }
        const nextToken = result.IsTruncated
          ? result.NextContinuationToken
          : undefined;
        if (
          result.IsTruncated &&
          (!nextToken || seenContinuationTokens.has(nextToken))
        ) {
          throw new Error('invalid storage listing continuation');
        }
        if (nextToken) seenContinuationTokens.add(nextToken);
        continuationToken = nextToken;
      } while (continuationToken !== undefined);
      return objects;
    } catch {
      throw new SubmissionFileStorageError(
        SUBMISSION_FILE_STORAGE_ERROR_CODES.LIST_FAILED,
      );
    }
  }

  async delete(objectKey: string): Promise<void> {
    const { client, bucket } = this.requireClient();
    try {
      await client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }),
      );
    } catch (error) {
      if (isNotFound(error)) return;
      throw new SubmissionFileStorageError(
        SUBMISSION_FILE_STORAGE_ERROR_CODES.DELETE_FAILED,
      );
    }
  }

  async get(objectKey: string): Promise<Readable> {
    const { client, bucket } = this.requireClient();
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
      throw new SubmissionFileStorageError(
        SUBMISSION_FILE_STORAGE_ERROR_CODES.GET_FAILED,
      );
    } catch {
      throw new SubmissionFileStorageError(
        SUBMISSION_FILE_STORAGE_ERROR_CODES.GET_FAILED,
      );
    }
  }

  private requireClient(): {
    client: SubmissionFileS3Client;
    bucket: string;
  } {
    if (this.client !== undefined && this.bucket !== undefined) {
      return { client: this.client, bucket: this.bucket };
    }

    const settings = this.config.requireSettings();
    this.bucket = settings.bucket;
    this.client ??= new S3Client({
      endpoint: settings.endpoint,
      region: settings.region,
      forcePathStyle: settings.forcePathStyle,
      credentials: {
        accessKeyId: settings.accessKeyId,
        secretAccessKey: settings.secretAccessKey,
      },
    }) as SubmissionFileS3Client;
    return { client: this.client, bucket: this.bucket };
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

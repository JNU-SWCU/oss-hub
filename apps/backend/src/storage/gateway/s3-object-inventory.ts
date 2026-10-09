import { Inject, Injectable, Optional } from '@nestjs/common';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import {
  OBJECT_STORAGE_ERROR_CODES,
  ObjectStorageError,
  type ObjectInventoryEntry,
  type ObjectInventoryPort,
} from '../domain/object-storage';
import {
  ObjectS3Connection,
  ObjectStorageConfig,
  S3_OBJECT_CLIENT,
  type ObjectS3Client,
} from '../object-storage.config';

const OBJECT_LIST_REQUEST_TIMEOUT_MS = 30_000;

@Injectable()
export class S3ObjectInventory implements ObjectInventoryPort {
  private readonly connection: ObjectS3Connection;

  constructor(
    config: ObjectStorageConfig,
    @Optional()
    @Inject(S3_OBJECT_CLIENT)
    client?: ObjectS3Client,
  ) {
    this.connection = new ObjectS3Connection(config, client);
  }

  async listObjects(
    prefixes: readonly string[],
  ): Promise<readonly ObjectInventoryEntry[]> {
    const { client, bucket } = this.connection.requireClient();
    const objects: ObjectInventoryEntry[] = [];
    try {
      for (const prefix of prefixes) {
        objects.push(
          ...(await this.listObjectsByPrefix(client, bucket, prefix)),
        );
      }
      return objects;
    } catch {
      throw new ObjectStorageError(OBJECT_STORAGE_ERROR_CODES.LIST_FAILED);
    }
  }

  private async listObjectsByPrefix(
    client: ObjectS3Client,
    bucket: string,
    prefix: string,
  ): Promise<readonly ObjectInventoryEntry[]> {
    const objects: ObjectInventoryEntry[] = [];
    const seenContinuationTokens = new Set<string>();
    let continuationToken: string | undefined;
    do {
      const result = (await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
        { abortSignal: AbortSignal.timeout(OBJECT_LIST_REQUEST_TIMEOUT_MS) },
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
  }
}

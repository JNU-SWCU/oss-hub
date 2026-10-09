import { Inject, Injectable } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  OBJECT_STORAGE_ERROR_CODES,
  ObjectStorageError,
} from './domain/object-storage';
import {
  loadRuntimeConfig,
  type RuntimeConfig,
} from '../runtime-config/runtime-config';
import { RUNTIME_CONFIG } from '../runtime-config/runtime-config.module';

export const S3_OBJECT_CLIENT = Symbol('S3_OBJECT_CLIENT');

export interface ObjectStorageSettings {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export interface ObjectS3Client {
  send(
    command:
      | PutObjectCommand
      | GetObjectCommand
      | ListObjectsV2Command
      | DeleteObjectCommand,
    options?: { abortSignal?: AbortSignal },
  ): Promise<unknown>;
}

type ObjectStorageMode = 'local' | 'managed';

@Injectable()
export class ObjectStorageConfig {
  constructor(
    @Inject(RUNTIME_CONFIG)
    private readonly runtimeConfig: RuntimeConfig = loadRuntimeConfig(
      process.env,
    ),
  ) {}

  requireSettings(): ObjectStorageSettings {
    const mode = storageModeValue(
      this.runtimeConfig.SUBMISSION_FILE_STORAGE_MODE,
    );
    const endpoint = configValue(
      this.runtimeConfig.SUBMISSION_FILE_S3_ENDPOINT,
    );
    const region = configValue(this.runtimeConfig.SUBMISSION_FILE_S3_REGION);
    const bucket = configValue(this.runtimeConfig.SUBMISSION_FILE_S3_BUCKET);
    const accessKeyId = configValue(
      this.runtimeConfig.SUBMISSION_FILE_S3_ACCESS_KEY_ID,
    );
    const secretAccessKey = configValue(
      this.runtimeConfig.SUBMISSION_FILE_S3_SECRET_ACCESS_KEY,
    );
    const forcePathStyle = booleanConfigValue(
      this.runtimeConfig.SUBMISSION_FILE_S3_FORCE_PATH_STYLE,
    );

    if (
      endpoint === null ||
      region === null ||
      bucket === null ||
      accessKeyId === null ||
      secretAccessKey === null ||
      forcePathStyle === null ||
      mode === null ||
      !isAllowedEndpointForMode(endpoint, mode) ||
      (mode === 'managed' && (region !== 'auto' || forcePathStyle !== true))
    ) {
      throw new ObjectStorageError(OBJECT_STORAGE_ERROR_CODES.CONFIGURATION);
    }

    return {
      endpoint,
      region,
      bucket,
      accessKeyId,
      secretAccessKey,
      forcePathStyle,
    };
  }
}

export class ObjectS3Connection {
  private client: ObjectS3Client | undefined;
  private bucket: string | undefined;

  constructor(
    private readonly config: ObjectStorageConfig,
    client?: ObjectS3Client,
  ) {
    this.client = client;
  }

  requireClient(): { client: ObjectS3Client; bucket: string } {
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
    }) as ObjectS3Client;
    return { client: this.client, bucket: this.bucket };
  }
}

function storageModeValue(raw: string | undefined): ObjectStorageMode | null {
  if (raw === 'local' || raw === 'managed') return raw;
  return null;
}

function configValue(raw: string | undefined): string | null {
  const value = raw?.trim();
  return value && value.length > 0 ? value : null;
}

function booleanConfigValue(raw: string | undefined): boolean | null {
  const value = configValue(raw)?.toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function isAllowedEndpointForMode(
  endpoint: string,
  mode: ObjectStorageMode,
): boolean {
  if (!/^https?:\/\//i.test(endpoint)) {
    return false;
  }
  try {
    const url = new URL(endpoint);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/' ||
      hasRawCredentialsQueryOrFragment(endpoint)
    ) {
      return false;
    }
    if (mode === 'local') {
      return url.protocol === 'http:' && isAllowedHttpHost(url.hostname);
    }
    return (
      url.protocol === 'https:' &&
      url.port === '' &&
      isExternalManagedHost(url.hostname)
    );
  } catch {
    return false;
  }
}

function hasRawCredentialsQueryOrFragment(raw: string): boolean {
  const schemeSep = raw.indexOf('://');
  if (schemeSep < 0) {
    return false;
  }
  const hierarchical = raw.slice(schemeSep + 3);
  const authorityEnd = hierarchical.search(/[/?#]/);
  const authority =
    authorityEnd === -1 ? hierarchical : hierarchical.slice(0, authorityEnd);
  if (authority.includes('@')) {
    return true;
  }
  const afterAuthority =
    authorityEnd === -1 ? '' : hierarchical.slice(authorityEnd);
  return afterAuthority.includes('?') || afterAuthority.includes('#');
}

function isExternalManagedHost(hostname: string): boolean {
  return /^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/i.test(hostname);
}

function isAllowedHttpHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === 'object-storage') return true;
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return isPrivateIPv6(hostname.slice(1, -1));
  }
  if (isIPv4(hostname)) return isPrivateIPv4(hostname);
  return false;
}

function isIPv4(hostname: string): boolean {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
}

function isPrivateIPv4(hostname: string): boolean {
  const octets = hostname.split('.').map(Number);
  const a = octets[0] ?? -1;
  const b = octets[1] ?? -1;
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

function isPrivateIPv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === '::1') return true;
  const firstGroup = normalized.split(':', 1)[0] ?? '';
  if (!/^[0-9a-f]{1,4}$/.test(firstGroup)) return false;
  const padded = firstGroup.padStart(4, '0');
  const firstByte = parseInt(padded.slice(0, 2), 16);
  const secondByte = parseInt(padded.slice(2, 4), 16);
  if (firstByte === 0xfc || firstByte === 0xfd) return true;
  if (firstByte === 0xfe && secondByte >= 0x80 && secondByte <= 0xbf)
    return true;
  return false;
}

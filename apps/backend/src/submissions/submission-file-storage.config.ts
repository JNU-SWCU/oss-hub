import { Inject, Injectable } from '@nestjs/common';
import {
  SUBMISSION_FILE_STORAGE_ERROR_CODES,
  SubmissionFileStorageError,
} from './submission-file-storage.port';
import {
  loadRuntimeConfig,
  type RuntimeConfig,
} from '../runtime-config/runtime-config';
import { RUNTIME_CONFIG } from '../runtime-config/runtime-config.module';

export interface SubmissionFileStorageSettings {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

@Injectable()
export class SubmissionFileStorageConfig {
  constructor(
    @Inject(RUNTIME_CONFIG)
    private readonly runtimeConfig: RuntimeConfig = loadRuntimeConfig(
      process.env,
    ),
  ) {}

  requireSettings(): SubmissionFileStorageSettings {
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
      !isAllowedEndpoint(endpoint)
    ) {
      throw new SubmissionFileStorageError(
        SUBMISSION_FILE_STORAGE_ERROR_CODES.CONFIGURATION,
      );
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

// Endpoint 허용은 노출 면으로 판정한다.
// - credentials/query/fragment는 protocol 수락 전에 항상 거부
//   (WHATWG getters는 present-empty `?`/`#`/`@` 형태를 빈 문자열로 정규화하므로 raw 입력도 본다)
// - https는 외부 호스트 허용
// - http는 loopback·사설/링크로컬 주소와 Compose 내부 서비스명 `minio`만 허용
function isAllowedEndpoint(endpoint: string): boolean {
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
      hasRawCredentialsQueryOrFragment(endpoint)
    ) {
      return false;
    }
    if (url.protocol === 'https:') return true;
    if (url.protocol === 'http:') return isAllowedHttpHost(url.hostname);
    return false;
  } catch {
    return false;
  }
}

/**
 * Detect credentials/query/fragment delimiters on the raw input.
 * Percent-encoded path octets (`%3F`, `%23`) are not delimiters.
 */
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

function isAllowedHttpHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === 'minio') return true;
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

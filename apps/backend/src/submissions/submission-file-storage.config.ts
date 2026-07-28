import { Injectable } from '@nestjs/common';
import {
  SUBMISSION_FILE_STORAGE_ERROR_CODES,
  SubmissionFileStorageError,
} from './submission-file-storage.port';

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
  requireSettings(): SubmissionFileStorageSettings {
    const endpoint = environmentValue('SUBMISSION_FILE_S3_ENDPOINT');
    const region = environmentValue('SUBMISSION_FILE_S3_REGION');
    const bucket = environmentValue('SUBMISSION_FILE_S3_BUCKET');
    const accessKeyId = environmentValue('SUBMISSION_FILE_S3_ACCESS_KEY_ID');
    const secretAccessKey = environmentValue(
      'SUBMISSION_FILE_S3_SECRET_ACCESS_KEY',
    );
    const forcePathStyle = booleanEnvironmentValue(
      'SUBMISSION_FILE_S3_FORCE_PATH_STYLE',
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

function environmentValue(name: string): string | null {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : null;
}

function booleanEnvironmentValue(name: string): boolean | null {
  const value = environmentValue(name)?.toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

// http는 트래픽이 호스트/사설망을 벗어나지 않는 대상에만 허용한다.
function isAllowedEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (url.protocol === 'https:') return true;
    return isPrivateHost(url.hostname);
  } catch {
    return false;
  }
}

function isPrivateHost(hostname: string): boolean {
  if (hostname === 'localhost') return true;
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return isPrivateIPv6(hostname.slice(1, -1));
  }
  if (isIPv4(hostname)) return isPrivateIPv4(hostname);
  return !hostname.includes('.');
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

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

function isAllowedEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return process.env.NODE_ENV !== 'production' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

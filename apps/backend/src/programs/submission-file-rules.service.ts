import { Injectable } from '@nestjs/common';
import {
  SubmissionZipRejection,
  MAX_ENTRY_COUNT,
  MAX_TOTAL_UNCOMPRESSED_BYTES,
  MAX_ENTRY_UNCOMPRESSED_BYTES,
} from './submission-zip.error';
import { fromBufferPromise, type Entry } from 'yauzl';
import { SUBMISSION_FILE_EXTENSIONS } from './submission-upload.config';
import { randomUUID } from 'node:crypto';

@Injectable()
export class SubmissionFileRulesService {
  safeSubmissionFileContentType(fileName: string): string {
    const extension = submissionFileExtension(fileName);
    return extension === null
      ? 'application/octet-stream'
      : (CANONICAL_CONTENT_TYPES[extension] ?? 'application/octet-stream');
  }

  addOneCalendarYear(value: Date): Date {
    const result = new Date(value);
    const month = result.getUTCMonth();
    result.setUTCFullYear(result.getUTCFullYear() + 1);
    if (month === 1 && result.getUTCMonth() !== month) {
      result.setUTCDate(0);
    }
    return result;
  }

  isAllowedSubmissionFileType(fileName: string): boolean {
    const extension = submissionFileExtension(fileName);
    return extension !== null && ALLOWED_SUBMISSION_EXTENSIONS.has(extension);
  }

  createSubmissionFileObjectKey(): string {
    return `submission-files/${randomUUID()}`;
  }

  sanitizeSubmissionFileOriginalName(name: string): string {
    const baseName = name.replaceAll('\\', '/').split('/').at(-1) ?? '';
    const sanitized = [...baseName]
      .filter(IS_SAFE_CHARACTER)
      .join('')
      .trim()
      .slice(0, MAX_ORIGINAL_NAME_LENGTH);

    return sanitized.length > 0 && sanitized !== '.' && sanitized !== '..'
      ? sanitized
      : 'file';
  }

  hasValidSubmissionFileSignature(buffer: Buffer, fileName: string): boolean {
    const extension = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
    return (
      FILE_SIGNATURES[extension]?.some(
        (signature) =>
          buffer.length >= signature.length &&
          buffer.subarray(0, signature.length).equals(signature),
      ) ?? false
    );
  }

  hasValidSubmissionTemplateSignature(
    buffer: Buffer,
    fileName: string,
  ): boolean {
    const dot = fileName.lastIndexOf('.');
    if (dot <= 0) return false;
    const signature = IMAGE_SIGNATURES[fileName.slice(dot).toLowerCase()];
    return signature === undefined
      ? this.hasValidSubmissionFileSignature(buffer, fileName)
      : buffer.subarray(0, signature.length).equals(signature);
  }

  async inspectSubmissionZipMetadata(
    buffer: Buffer,
  ): Promise<SubmissionZipRejection | null> {
    try {
      const zipFile = await fromBufferPromise(buffer, {
        decodeStrings: true,
        strictFileNames: true,
        validateEntrySizes: true,
      });
      if (zipFile.entryCount > MAX_ENTRY_COUNT) {
        return SubmissionZipRejection.TOO_MANY_ENTRIES;
      }

      let entryCount = 0;
      let totalCompressedBytes = 0;
      let totalUncompressedBytes = 0;
      for await (const entry of zipFile.eachEntry()) {
        entryCount += 1;
        const entryRejection = inspectEntry(entry);
        if (entryRejection !== null) return entryRejection;

        totalCompressedBytes += entry.compressedSize;
        totalUncompressedBytes += entry.uncompressedSize;
        if (totalUncompressedBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
          return SubmissionZipRejection.CONTENT_TOO_LARGE;
        }
        if (
          exceedsCompressionRatio(totalUncompressedBytes, totalCompressedBytes)
        ) {
          return SubmissionZipRejection.EXPANDS_TOO_MUCH;
        }
      }

      return entryCount === zipFile.entryCount
        ? null
        : SubmissionZipRejection.UNREADABLE;
    } catch {
      return SubmissionZipRejection.UNREADABLE;
    }
  }
}

const CANONICAL_CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.pdf': 'application/pdf',
  '.hwp': 'application/x-hwp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.zip': 'application/zip',
};

function submissionFileExtension(fileName: string): string | null {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) return null;
  return fileName.slice(dot).toLowerCase();
}

const ALLOWED_SUBMISSION_EXTENSIONS = new Set<string>(
  SUBMISSION_FILE_EXTENSIONS,
);

const MAX_ORIGINAL_NAME_LENGTH = 255;

const IS_SAFE_CHARACTER = (character: string): boolean => {
  const characterCode = character.charCodeAt(0);
  return characterCode > 0x1f && characterCode !== 0x7f;
};

const FILE_SIGNATURES: Readonly<Record<string, readonly Buffer[]>> = {
  '.pdf': [Buffer.from('%PDF-')],
  '.hwp': [Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])],
  '.zip': [
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from([0x50, 0x4b, 0x05, 0x06]),
    Buffer.from([0x50, 0x4b, 0x07, 0x08]),
  ],
};

const IMAGE_SIGNATURES: Readonly<Record<string, Buffer>> = {
  '.jpg': Buffer.from([0xff, 0xd8, 0xff]),
  '.jpeg': Buffer.from([0xff, 0xd8, 0xff]),
  '.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
};

const MAX_COMPRESSION_RATIO = 100;

const UNIX_HOST_SYSTEM = 3;

const UNIX_FILE_TYPE_MASK = 0xf000;

const UNIX_SYMLINK_TYPE = 0xa000;

function inspectEntry(entry: Entry): SubmissionZipRejection | null {
  const fileName = entry.fileName.toLowerCase();
  if (entry.fileName.includes('\u0000')) {
    return SubmissionZipRejection.ENTRY_NOT_ALLOWED;
  }
  if (fileName.endsWith('.zip')) return SubmissionZipRejection.NESTED_ARCHIVE;
  if (isUnixSymlink(entry)) return SubmissionZipRejection.ENTRY_NOT_ALLOWED;
  if (entry.isEncrypted()) return SubmissionZipRejection.PASSWORD_PROTECTED;
  if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
    return SubmissionZipRejection.UNSUPPORTED_COMPRESSION;
  }
  if (entry.uncompressedSize > MAX_ENTRY_UNCOMPRESSED_BYTES) {
    return SubmissionZipRejection.CONTENT_TOO_LARGE;
  }
  if (exceedsCompressionRatio(entry.uncompressedSize, entry.compressedSize)) {
    return SubmissionZipRejection.EXPANDS_TOO_MUCH;
  }
  return null;
}

function isUnixSymlink(entry: Entry): boolean {
  const hostSystem = entry.versionMadeBy >>> 8;
  const unixFileType =
    (entry.externalFileAttributes >>> 16) & UNIX_FILE_TYPE_MASK;
  return hostSystem === UNIX_HOST_SYSTEM && unixFileType === UNIX_SYMLINK_TYPE;
}

function exceedsCompressionRatio(
  uncompressedBytes: number,
  compressedBytes: number,
): boolean {
  return uncompressedBytes > compressedBytes * MAX_COMPRESSION_RATIO;
}

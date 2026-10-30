import { fromBufferPromise, type Entry } from 'yauzl';

const MAX_ENTRY_COUNT = 1_000;
const MAX_ENTRY_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 100;
const UNIX_HOST_SYSTEM = 3;
const UNIX_FILE_TYPE_MASK = 0xf000;
const UNIX_SYMLINK_TYPE = 0xa000;

export const SubmissionZipRejection = {
  UNREADABLE: 'UNREADABLE',

  ENTRY_NOT_ALLOWED: 'ENTRY_NOT_ALLOWED',

  NESTED_ARCHIVE: 'NESTED_ARCHIVE',

  PASSWORD_PROTECTED: 'PASSWORD_PROTECTED',

  UNSUPPORTED_COMPRESSION: 'UNSUPPORTED_COMPRESSION',

  TOO_MANY_ENTRIES: 'TOO_MANY_ENTRIES',

  CONTENT_TOO_LARGE: 'CONTENT_TOO_LARGE',

  EXPANDS_TOO_MUCH: 'EXPANDS_TOO_MUCH',
} as const;

export type SubmissionZipRejection =
  (typeof SubmissionZipRejection)[keyof typeof SubmissionZipRejection];

export const SUBMISSION_ZIP_REJECTION_MESSAGES: Readonly<
  Record<SubmissionZipRejection, string>
> = {
  [SubmissionZipRejection.UNREADABLE]:
    '압축 파일을 열 수 없습니다. 파일이 손상되지 않았는지 확인하고 다시 압축해 제출해 주세요.',
  [SubmissionZipRejection.ENTRY_NOT_ALLOWED]:
    '압축 파일에 담을 수 없는 항목이 있습니다. 바로가기 대신 실제 파일만 담아 다시 압축해 주세요.',
  [SubmissionZipRejection.NESTED_ARCHIVE]:
    '압축 파일 안에 또 다른 압축 파일이 있습니다. 안쪽 압축을 풀고 다시 압축해 주세요.',
  [SubmissionZipRejection.PASSWORD_PROTECTED]:
    '비밀번호가 걸린 압축 파일은 제출할 수 없습니다. 비밀번호 없이 다시 압축해 주세요.',
  [SubmissionZipRejection.UNSUPPORTED_COMPRESSION]:
    '이 압축 방식은 제출할 수 없습니다. 컴퓨터에 기본으로 있는 압축 기능으로 다시 압축해 주세요.',
  [SubmissionZipRejection.TOO_MANY_ENTRIES]: `압축 파일에 담긴 파일이 너무 많습니다. ${MAX_ENTRY_COUNT.toLocaleString('en-US')}개 이하로 줄여 다시 압축해 주세요.`,
  [SubmissionZipRejection.CONTENT_TOO_LARGE]: `압축을 풀었을 때의 크기가 너무 큽니다. 파일 하나는 ${MAX_ENTRY_UNCOMPRESSED_BYTES / 1024 / 1024} MB, 전체는 ${MAX_TOTAL_UNCOMPRESSED_BYTES / 1024 / 1024} MB 이하가 되도록 줄여 주세요.`,
  [SubmissionZipRejection.EXPANDS_TOO_MUCH]:
    '압축을 풀면 크기가 지나치게 불어나는 파일이 들어 있습니다. 그 파일을 빼고 다시 압축하거나 담당 교직원에게 문의해 주세요.',
};

export async function inspectSubmissionZipMetadata(
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

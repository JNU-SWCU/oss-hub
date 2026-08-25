import { fromBufferPromise, type Entry } from 'yauzl';

const MAX_ENTRY_COUNT = 1_000;
const MAX_ENTRY_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 100;
const UNIX_HOST_SYSTEM = 3;
const UNIX_FILE_TYPE_MASK = 0xf000;
const UNIX_SYMLINK_TYPE = 0xa000;

export async function isSafeSubmissionZipMetadata(
  buffer: Buffer,
): Promise<boolean> {
  try {
    const zipFile = await fromBufferPromise(buffer, {
      decodeStrings: true,
      strictFileNames: true,
      validateEntrySizes: true,
    });
    if (zipFile.entryCount > MAX_ENTRY_COUNT) return false;

    let entryCount = 0;
    let totalCompressedBytes = 0;
    let totalUncompressedBytes = 0;
    for await (const entry of zipFile.eachEntry()) {
      entryCount += 1;
      if (!isSafeEntry(entry)) return false;

      totalCompressedBytes += entry.compressedSize;
      totalUncompressedBytes += entry.uncompressedSize;
      if (
        totalUncompressedBytes > MAX_TOTAL_UNCOMPRESSED_BYTES ||
        exceedsCompressionRatio(totalUncompressedBytes, totalCompressedBytes)
      ) {
        return false;
      }
    }
    return entryCount === zipFile.entryCount;
  } catch {
    return false;
  }
}

function isSafeEntry(entry: Entry): boolean {
  const fileName = entry.fileName.toLowerCase();
  return (
    !entry.fileName.includes('\u0000') &&
    !fileName.endsWith('.zip') &&
    !isUnixSymlink(entry) &&
    !entry.isEncrypted() &&
    (entry.compressionMethod === 0 || entry.compressionMethod === 8) &&
    entry.uncompressedSize <= MAX_ENTRY_UNCOMPRESSED_BYTES &&
    !exceedsCompressionRatio(entry.uncompressedSize, entry.compressedSize)
  );
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

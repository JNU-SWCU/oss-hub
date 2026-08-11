import { inflateRawSync } from 'node:zlib';

export type ZipEntry = {
  readonly path: string;
  readonly bytes: Buffer;
};

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;

export function zipEntries(bytes: Buffer): readonly ZipEntry[] {
  const directory = centralDirectory(bytes);
  const entries: ZipEntry[] = [];
  let cursor = directory.offset;
  for (let index = 0; index < directory.entries; index += 1) {
    if (bytes.readUInt32LE(cursor) !== CENTRAL_DIRECTORY_HEADER) {
      throw new Error('ZIP central-directory entry is invalid.');
    }
    const compression = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const path = bytes.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    entries.push({
      path,
      bytes: entryBytes(
        bytes,
        localOffset,
        compression,
        compressedSize,
        uncompressedSize,
      ),
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function zipManifest(bytes: Buffer): readonly string[] {
  return zipEntries(bytes)
    .map((entry) => entry.path)
    .sort();
}

export function zipEntry(bytes: Buffer, path: string): ZipEntry {
  const entry = zipEntries(bytes).find((candidate) => candidate.path === path);
  if (entry === undefined) throw new Error(`ZIP does not contain ${path}.`);
  return entry;
}

function centralDirectory(bytes: Buffer): {
  readonly entries: number;
  readonly offset: number;
} {
  for (
    let cursor = bytes.length - 22;
    cursor >= Math.max(0, bytes.length - 65_557);
    cursor -= 1
  ) {
    if (bytes.readUInt32LE(cursor) === END_OF_CENTRAL_DIRECTORY) {
      return {
        entries: bytes.readUInt16LE(cursor + 10),
        offset: bytes.readUInt32LE(cursor + 16),
      };
    }
  }
  throw new Error('ZIP end-of-central-directory record is missing.');
}

function entryBytes(
  archive: Buffer,
  localOffset: number,
  compression: number,
  compressedSize: number,
  uncompressedSize: number,
): Buffer {
  if (archive.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER) {
    throw new Error('ZIP local-file entry is invalid.');
  }
  const nameLength = archive.readUInt16LE(localOffset + 26);
  const extraLength = archive.readUInt16LE(localOffset + 28);
  const bodyOffset = localOffset + 30 + nameLength + extraLength;
  const compressed = archive.subarray(bodyOffset, bodyOffset + compressedSize);
  const body =
    compression === 0 ? compressed : inflate(compression, compressed);
  if (body.byteLength !== uncompressedSize) {
    throw new Error('ZIP entry length does not match its central directory.');
  }
  return body;
}

function inflate(compression: number, bytes: Buffer): Buffer {
  if (compression !== 8)
    throw new Error(`Unsupported ZIP compression: ${compression}.`);
  return inflateRawSync(bytes);
}

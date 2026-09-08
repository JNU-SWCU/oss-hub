import { Readable } from 'node:stream';

/** Reads actual, uncompressed ZIP central-directory entries, not the plan. */
export function archiveEntries(archive: Buffer) {
  const entries: { name: string; body: Buffer }[] = [];
  for (let at = 0; at <= archive.length - 46; at += 1) {
    if (archive.readUInt32LE(at) !== 0x02014b50) continue;
    const size = archive.readUInt32LE(at + 24);
    const nameLength = archive.readUInt16LE(at + 28);
    const extraLength = archive.readUInt16LE(at + 30);
    const commentLength = archive.readUInt16LE(at + 32);
    const localAt = archive.readUInt32LE(at + 42);
    const bodyAt =
      localAt +
      30 +
      archive.readUInt16LE(localAt + 26) +
      archive.readUInt16LE(localAt + 28);
    entries.push({
      name: archive.subarray(at + 46, at + 46 + nameLength).toString('utf8'),
      body: archive.subarray(bodyAt, bodyAt + size),
    });
    at += 46 + nameLength + extraLength + commentLength - 1;
  }
  return entries;
}

export async function collectArchive(body: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    if (!Buffer.isBuffer(chunk)) throw new Error('Expected binary archive');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

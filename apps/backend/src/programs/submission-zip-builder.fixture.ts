export type ZipEntryFixture = {
  readonly name: string;
  readonly compressedSize?: number;
  readonly compressionMethod?: number;
  readonly externalAttributes?: number;
  readonly flags?: number;
  readonly uncompressedSize?: number;
  readonly versionMadeBy?: number;
};

export function signatureValidZip(entries: readonly ZipEntryFixture[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;
  let centralDirectorySize = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const compressedSize = entry.compressedSize ?? 1;
    const uncompressedSize = entry.uncompressedSize ?? compressedSize;
    const compressionMethod = entry.compressionMethod ?? 0;
    const flags = entry.flags ?? 0;
    const data = Buffer.alloc(compressedSize, 0x41);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(flags, 6);
    localHeader.writeUInt16LE(compressionMethod, 8);
    localHeader.writeUInt32LE(0, 10);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(compressedSize, 18);
    localHeader.writeUInt32LE(uncompressedSize, 22);
    localHeader.writeUInt16LE(name.byteLength, 26);
    localHeader.writeUInt16LE(0, 28);

    const centralDirectory = Buffer.alloc(46);
    centralDirectory.writeUInt32LE(0x02014b50, 0);
    centralDirectory.writeUInt16LE(entry.versionMadeBy ?? 20, 4);
    centralDirectory.writeUInt16LE(20, 6);
    centralDirectory.writeUInt16LE(flags, 8);
    centralDirectory.writeUInt16LE(compressionMethod, 10);
    centralDirectory.writeUInt32LE(0, 12);
    centralDirectory.writeUInt32LE(0, 16);
    centralDirectory.writeUInt32LE(compressedSize, 20);
    centralDirectory.writeUInt32LE(uncompressedSize, 24);
    centralDirectory.writeUInt16LE(name.byteLength, 28);
    centralDirectory.writeUInt16LE(0, 30);
    centralDirectory.writeUInt16LE(0, 32);
    centralDirectory.writeUInt16LE(0, 34);
    centralDirectory.writeUInt16LE(0, 36);
    centralDirectory.writeUInt32LE(entry.externalAttributes ?? 0, 38);
    centralDirectory.writeUInt32LE(localOffset, 42);

    localParts.push(localHeader, name, data);
    centralParts.push(centralDirectory, name);
    localOffset += localHeader.byteLength + name.byteLength + data.byteLength;
    centralDirectorySize += centralDirectory.byteLength + name.byteLength;
  }

  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(0, 4);
  endOfCentralDirectory.writeUInt16LE(0, 6);
  endOfCentralDirectory.writeUInt16LE(entries.length, 8);
  endOfCentralDirectory.writeUInt16LE(entries.length, 10);
  endOfCentralDirectory.writeUInt32LE(centralDirectorySize, 12);
  endOfCentralDirectory.writeUInt32LE(localOffset, 16);
  endOfCentralDirectory.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, endOfCentralDirectory]);
}

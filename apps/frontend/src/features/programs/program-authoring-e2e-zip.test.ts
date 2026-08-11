import { describe, expect, it } from 'vitest';
import {
  zipEntry,
  zipManifest,
} from '../../../e2e/support/program-authoring-zip';

type SourceEntry = {
  readonly path: string;
  readonly body: string;
};

describe('program authoring E2E ZIP support', () => {
  it('reads stable member paths and the submission-status CSV bytes', () => {
    const archive = storedZip([
      { path: '팀/필수 계획서.pdf', body: 'current-file' },
      { path: '제출현황.csv', body: 'team,status\n' },
    ]);

    expect(zipManifest(archive)).toEqual([
      '제출현황.csv',
      '팀/필수 계획서.pdf',
    ]);
    expect(zipEntry(archive, '제출현황.csv').bytes.toString('utf8')).toBe(
      'team,status\n',
    );
  });

  it('rejects a request for a missing archive member', () => {
    expect(() => zipEntry(storedZip([]), '제출현황.csv')).toThrow(
      /does not contain/,
    );
  });
});

function storedZip(entries: readonly SourceEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8');
    const body = Buffer.from(entry.body, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(name.byteLength, 26);
    local.writeUInt16LE(body.byteLength, 18);
    local.writeUInt16LE(body.byteLength, 22);
    localParts.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt32LE(body.byteLength, 20);
    central.writeUInt32LE(body.byteLength, 24);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.byteLength + name.byteLength + body.byteLength;
  }
  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.byteLength, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, central, end]);
}

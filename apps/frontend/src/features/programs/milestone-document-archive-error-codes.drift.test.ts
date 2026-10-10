import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MILESTONE_DOCUMENT_ARCHIVE_ERROR_CODES } from './milestone-document-upload-policy';

const REGISTRY_PATH = path.resolve(
  __dirname,
  '../../../../backend/src/milestone-documents/domain/milestone-documents-error-code.enum.ts',
);

function parseBackendArchiveCodes(source: string): string[] {
  const codes = [...source.matchAll(/\n  ZIP_[A-Z_]+: '(MSD_\d{3})',/g)].map(
    (match) => match[1],
  );
  if (codes.length === 0) {
    throw new Error(
      "backend milestone-documents-error-code.enum.ts에서 `ZIP_*: 'MSD_0..'` 선언을 찾지 못했다",
    );
  }
  return codes;
}

describe('서류 압축 내용 거절 코드가 backend와 어긋나지 않는다', () => {
  it('화면이 아는 목록과 서버가 내는 목록이 같다', () => {
    const source = readFileSync(REGISTRY_PATH, 'utf-8');

    expect([...MILESTONE_DOCUMENT_ARCHIVE_ERROR_CODES].sort()).toEqual(
      parseBackendArchiveCodes(source).sort(),
    );
  });

  it('형식 거절 코드는 이 목록에 없다', () => {
    expect(MILESTONE_DOCUMENT_ARCHIVE_ERROR_CODES.has('MSD_010')).toBe(false);
  });

  it('선언을 하나도 찾지 못하면 실패한다', () => {
    expect(() => parseBackendArchiveCodes('export const OTHER = 1;')).toThrow(
      /찾지 못했다/,
    );
  });
});

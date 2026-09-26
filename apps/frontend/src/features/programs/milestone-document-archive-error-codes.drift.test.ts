// 서류 화면이 아는 「압축 내용 거절」 코드 목록이 backend 레지스트리와 어긋나면, 새 코드는
// 파일 입력이 아니라 폼 아래 줄로 떨어져 고를 때 뜬 같은 문장이 두 번 읽힌다(#1108).
// frontend가 apps/backend/src를 import할 수 없으므로 제출 화면의
// `submission-archive-error-codes.drift.test.ts`와 같은 방식으로 소스를 텍스트로 읽는다.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MILESTONE_DOCUMENT_ARCHIVE_ERROR_CODES } from './milestone-document-upload-policy';

const REGISTRY_PATH = path.resolve(
  __dirname,
  '../../../../backend/src/milestone-documents/milestone-documents-error-code.enum.ts',
);

// ⚠ 읽어 낸 것만 믿지 않는다 — 하나도 못 읽으면 실패한다(fail-closed).
function parseBackendArchiveCodes(source: string): string[] {
  const codes = [...source.matchAll(/\n  ZIP_[A-Z_]+: '(MSD_\d{3})',/g)].map(
    (match) => match[1]!,
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
    // MSD_010(UNSUPPORTED_FILE_TYPE)이 섞이면 형식 거절까지 파일 입력으로 옮겨 가 지금 자리를 잃는다.
    expect(MILESTONE_DOCUMENT_ARCHIVE_ERROR_CODES.has('MSD_010')).toBe(false);
  });

  it('선언을 하나도 찾지 못하면 실패한다', () => {
    expect(() => parseBackendArchiveCodes('export const OTHER = 1;')).toThrow(
      /찾지 못했다/,
    );
  });
});

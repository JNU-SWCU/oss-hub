// 화면이 아는 「압축 내용 거절」 코드 목록이 backend 레지스트리와 어긋나면, 새 코드는 다시
// 「알 수 없는 코드」가 되어 파일 입력 옆이 아니라 화면 전체 오류로 밀려난다 — #1108이
// 고치려던 자리로 조용히 되돌아가는 셈이다. 모노레포에 공유 패키지가 없어 frontend가
// apps/backend/src를 직접 import할 수 없으므로(백엔드 모듈이 @nestjs/common·@prisma/client에
// 의존한다) 백엔드 소스를 텍스트로 읽어 비교한다 — lib/submission-upload-policy.drift.test.ts와
// 같은 방식이다.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SUBMISSION_ARCHIVE_ERROR_CODES } from './submission-form';

const REGISTRY_PATH = path.resolve(
  __dirname,
  '../../../../backend/src/submissions/submissions-error-code.enum.ts',
);

// ⚠ 읽어 낸 것만 믿지 않는다 — 하나도 못 읽으면 실패한다(fail-closed).
export function parseBackendArchiveCodes(source: string): string[] {
  const codes = [...source.matchAll(/\n  ZIP_[A-Z_]+: '(SUB_\d{3})',/g)].map(
    (match) => match[1]!,
  );
  if (codes.length === 0) {
    throw new Error(
      "backend submissions-error-code.enum.ts에서 `ZIP_*: 'SUB_0..'` 선언을 찾지 못했다",
    );
  }
  return codes;
}

describe('압축 내용 거절 코드가 backend와 어긋나지 않는다', () => {
  const source = readFileSync(REGISTRY_PATH, 'utf-8');

  it('화면이 아는 목록과 서버가 내는 목록이 같다', () => {
    expect([...SUBMISSION_ARCHIVE_ERROR_CODES].sort()).toEqual(
      parseBackendArchiveCodes(source).sort(),
    );
  });

  it('형식 거절 코드는 이 목록에 없다', () => {
    // SUB_018(UNSUPPORTED_FILE_TYPE)이 이 목록에 섞이면 형식 안내와 압축 안내가 다시 한 자리로
    // 합쳐진다.
    expect(SUBMISSION_ARCHIVE_ERROR_CODES.has('SUB_018')).toBe(false);
  });
});

describe('선언 파서 — 읽지 못한 것은 실패로 처리한다', () => {
  it('선언이 없으면 실패한다', () => {
    expect(() => parseBackendArchiveCodes('export const OTHER = 1;')).toThrow(
      /찾지 못했다/,
    );
  });
});

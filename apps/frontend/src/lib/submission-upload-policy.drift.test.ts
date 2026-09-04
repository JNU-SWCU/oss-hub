// 상한과 그 표기가 backend/frontend 사이에서 갈라지면, 화면은 학생에게 한 숫자를 약속하고
// 서버는 다른 숫자로 거절한다 — 학생은 무엇을 줄여야 하는지 모른 채 같은 파일을 다시 올린다.
// 모노레포에 공유 패키지가 없어 frontend가 apps/backend/src를 직접 import할 수 없으므로
// (백엔드 모듈이 @nestjs/common·@prisma/client에 의존한다), 백엔드 소스를 텍스트로 읽어
// 값을 뽑아 비교한다 — features/programs/application-answer-limits.drift.test.ts와 같은 방식이다.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SUBMISSION_UPLOAD_MAX_BYTES,
  SUBMISSION_UPLOAD_MAX_LABEL,
  SUBMISSION_UPLOAD_TOO_LARGE_MESSAGE,
} from './submission-upload-policy';

const POLICY_PATH = path.resolve(
  __dirname,
  '../../../backend/src/submissions/submission-upload-policy.ts',
);

// ⚠ 읽어 낸 것만 믿지 않는다 — 못 읽으면 실패한다(fail-closed). 선언이 사라지거나 형태가
//   바뀌었는데 조용히 통과하면 이 테스트는 아무것도 지키지 않는다.
export function parseBackendMaxBytes(source: string): number {
  const match =
    /export const SUBMISSION_UPLOAD_MAX_BYTES = (\d+) \* 1024 \* 1024;/.exec(
      source,
    );
  if (match === null) {
    throw new Error(
      'backend submission-upload-policy.ts에서 `SUBMISSION_UPLOAD_MAX_BYTES = N * 1024 * 1024;` 선언을 찾지 못했다',
    );
  }
  return Number(match[1]) * 1024 * 1024;
}

export function parseBackendMaxLabel(source: string): string {
  const match = /export const SUBMISSION_UPLOAD_MAX_LABEL = '([^']+)';/.exec(
    source,
  );
  if (match === null) {
    throw new Error(
      "backend submission-upload-policy.ts에서 `SUBMISSION_UPLOAD_MAX_LABEL = '...';` 선언을 찾지 못했다",
    );
  }
  return match[1]!;
}

describe('업로드 상한이 backend와 어긋나지 않는다', () => {
  const source = readFileSync(POLICY_PATH, 'utf-8');

  it('바이트 값이 양쪽에서 같다', () => {
    expect(SUBMISSION_UPLOAD_MAX_BYTES).toBe(parseBackendMaxBytes(source));
  });

  it('사람이 읽는 표기가 양쪽에서 같다', () => {
    expect(SUBMISSION_UPLOAD_MAX_LABEL).toBe(parseBackendMaxLabel(source));
  });

  it('상한 초과 문구가 서버가 내는 문장과 같다', () => {
    expect(source).toContain(
      '`파일은 ${SUBMISSION_UPLOAD_MAX_LABEL} 이하여야 합니다.`',
    );
    expect(SUBMISSION_UPLOAD_TOO_LARGE_MESSAGE).toBe(
      `파일은 ${parseBackendMaxLabel(source)} 이하여야 합니다.`,
    );
  });
});

describe('선언 파서 — 읽지 못한 것은 실패로 처리한다', () => {
  it('선언이 없으면 실패한다', () => {
    expect(() => parseBackendMaxBytes('export const OTHER = 1;')).toThrow(
      /찾지 못했다/,
    );
    expect(() => parseBackendMaxLabel('export const OTHER = 1;')).toThrow(
      /찾지 못했다/,
    );
  });

  it('계산식으로 바꿔 적은 값은 통과시키지 않는다', () => {
    expect(() =>
      parseBackendMaxBytes(
        'export const SUBMISSION_UPLOAD_MAX_BYTES = OTHER * 1024 * 1024;',
      ),
    ).toThrow(/찾지 못했다/);
  });
});

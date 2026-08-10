// 신청 항목 길이 상한이 backend/frontend 사이에서 어긋나면, 화면이 서버보다 느슨한
// 쪽으로 갈렸을 때 학생은 다 쓰고 제출하는 **순간에야** 400을 만난다(무엇을 줄여야
// 하는지도 모른 채). 반대로 화면이 더 엄격하면 서버가 받아 줄 글을 못 치게 막는다.
// 모노레포에 공유 패키지가 없어 frontend가 apps/backend/src를 직접 import할 수 없으므로
// (백엔드 모듈이 @nestjs/common·@prisma/client에 의존하고 frontend workspace에는 그
// 의존성이 없다), 백엔드 소스를 텍스트로 읽어 숫자를 직접 뽑아 비교한다 —
// features/audit-log/action-registry.test.ts와 같은 방식이다.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { APPLICATION_ANSWER_MAX_LENGTHS } from './application-answer-limits';

const VALIDATOR_PATH = path.resolve(
  __dirname,
  '../../../../backend/src/programs/application-answers.validator.ts',
);
const source = readFileSync(VALIDATOR_PATH, 'utf-8');

function backendLimits(): Readonly<Record<string, number>> {
  const declaration = 'export const APPLICATION_ANSWER_MAX_LENGTHS = {';
  const start = source.indexOf(declaration);
  if (start === -1) {
    throw new Error(
      'application-answers.validator.ts에서 APPLICATION_ANSWER_MAX_LENGTHS 선언을 찾지 못했다',
    );
  }
  const end = source.indexOf('}', start);
  const body = source.slice(start + declaration.length, end);
  const limits: Record<string, number> = {};
  for (const [, key, digits] of body.matchAll(/(\w+)\s*:\s*([\d_]+)\s*,/g)) {
    limits[key] = Number(digits.replaceAll('_', ''));
  }
  if (Object.keys(limits).length === 0) {
    throw new Error('백엔드 상한 값을 하나도 못 읽었다');
  }
  return limits;
}

describe('신청 항목 길이 상한이 backend와 어긋나지 않는다', () => {
  it('키와 값이 양쪽에서 같다', () => {
    expect(APPLICATION_ANSWER_MAX_LENGTHS).toEqual(backendLimits());
  });
});

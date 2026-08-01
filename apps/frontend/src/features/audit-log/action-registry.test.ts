// 감사 로그 action registry가 backend/frontend 사이에서 어긋나면 관리자가 필터에서
// 특정 action을 아예 조회할 수 없다(REPOSITORY_PUBLISHED가 병합된 뒤에도 프런트
// 필터 목록에는 반영되지 않았던 사례가 실제로 있었다). 모노레포에 공유 패키지가 없어
// frontend가 apps/backend/src를 직접 import할 수 없으므로(백엔드 모듈이
// @nestjs/common·@prisma/client에 의존하고 frontend workspace에는 그 의존성이 없다),
// apps/backend/src/audit-log/audit-log-metadata.ts를 텍스트로 읽어 action 문자열
// 값을 직접 추출해 비교한다 — apps/frontend/src/app/globals.css.test.ts와 같은 방식이다.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUDIT_LOG_ACTION_LABELS, AUDIT_LOG_ACTIONS } from './types';

const METADATA_PATH = path.resolve(
  __dirname,
  '../../../../backend/src/audit-log/audit-log-metadata.ts',
);
const source = readFileSync(METADATA_PATH, 'utf-8');

function extractActionValues(exportName: string): string[] {
  const declaration = `export const ${exportName} = {`;
  const start = source.indexOf(declaration);
  if (start === -1) {
    throw new Error(
      `audit-log-metadata.ts에서 ${exportName} 선언을 찾지 못했다`,
    );
  }
  const braceOpen = start + declaration.length - 1;
  const braceClose = source.indexOf('}', braceOpen);
  if (braceClose === -1) {
    throw new Error(`${exportName} 블록의 닫는 중괄호를 찾지 못했다`);
  }

  const body = source.slice(braceOpen + 1, braceClose);
  const values: string[] = [];
  const pattern = /:\s*'([A-Z][A-Z0-9_]*)'/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    values.push(match[1]);
  }
  return values;
}

const backendActions = [
  ...extractActionValues('ACCESS_AUDIT_ACTIONS'),
  ...extractActionValues('REPOSITORY_PUBLISH_AUDIT_ACTIONS'),
];

const frontendActions: readonly string[] = AUDIT_LOG_ACTIONS;

describe('감사 로그 action registry가 backend와 동기화되어 있다', () => {
  it('파싱 자체가 살아 있다(백엔드 파일 구조 변경으로 조용히 공허해지지 않는다)', () => {
    expect(backendActions.length).toBeGreaterThanOrEqual(7);
  });

  it('frontend 라벨 목록이 backend가 정의한 action 전체를 표현한다', () => {
    const missingFromFrontend = backendActions.filter(
      (action) => !frontendActions.includes(action),
    );

    expect(
      missingFromFrontend,
      `backend에는 있지만 frontend 필터/라벨에는 없는 action: ${
        missingFromFrontend.join(', ') || '없음'
      }`,
    ).toEqual([]);
  });

  it('frontend 목록에 backend registry에 없는 action이 없다(죽은 필터를 남기지 않는다)', () => {
    const extraInFrontend = frontendActions.filter(
      (action) => !backendActions.includes(action),
    );

    expect(
      extraInFrontend,
      `frontend에는 있지만 backend registry에는 없는 action: ${
        extraInFrontend.join(', ') || '없음'
      }`,
    ).toEqual([]);
  });

  it('모든 action에 빈 문자열이 아닌 한국어 라벨이 있다', () => {
    for (const action of AUDIT_LOG_ACTIONS) {
      expect(AUDIT_LOG_ACTION_LABELS[action].trim().length).toBeGreaterThan(0);
    }
  });

  it('REPOSITORY_PUBLISHED가 필터 목록에 포함된다(#470)', () => {
    expect(AUDIT_LOG_ACTIONS).toContain('REPOSITORY_PUBLISHED');
  });
});

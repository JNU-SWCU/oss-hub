// 감사 로그 action registry가 backend/frontend 사이에서 어긋나면 관리자가 필터에서
// 특정 action을 아예 조회할 수 없다(REPOSITORY_PUBLISHED가 병합된 뒤에도 프런트
// 필터 목록에는 반영되지 않았던 사례가 실제로 있었다). 모노레포에 공유 패키지가 없어
// frontend가 apps/backend/src를 직접 import할 수 없으므로(백엔드 모듈이
// @nestjs/common·@prisma/client에 의존하고 frontend workspace에는 그 의존성이 없다),
// apps/backend/src/audit-log/*-audit-metadata.ts를 텍스트로 읽어 action 문자열
// 값을 직접 추출해 비교한다 — apps/frontend/src/app/globals.css.test.ts와 같은 방식이다.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUDIT_LOG_ACTION_LABELS, AUDIT_LOG_ACTIONS } from './types';

const METADATA_FILES = [
  'access-audit-metadata.ts',
  'application-decision-audit-metadata.ts',
  'independent-authority-audit-metadata.ts',
  'operations-audit-metadata.ts',
  'repository-program-audit-metadata.ts',
  'user-profile-audit-metadata.ts',
  'web-state-audit-metadata.ts',
] as const;
const source = METADATA_FILES.map((file) =>
  readFileSync(
    path.resolve(__dirname, '../../../../backend/src/audit-log', file),
    'utf-8',
  ),
).join('\n');

function extractActionValues(exportName: string): string[] {
  const declaration = `export const ${exportName} = {`;
  const start = source.indexOf(declaration);
  if (start === -1) {
    throw new Error(
      `backend audit metadata에서 ${exportName} 선언을 찾지 못했다`,
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

const REQUIRED_ACTION_REGISTRIES = [
  'ACCESS_AUDIT_ACTIONS',
  'INDEPENDENT_AUTHORITY_AUDIT_COMMANDS',
  'REPOSITORY_PUBLISH_AUDIT_ACTIONS',
  'PROGRAM_LIFECYCLE_AUDIT_ACTIONS',
  'PROGRAM_DELETION_AUDIT_ACTIONS',
  'COLLECTION_TRIGGER_AUDIT_ACTIONS',
  'SUBMISSION_FILE_CLEANUP_AUDIT_ACTIONS',
  'APPLICATION_DECISION_AUDIT_ACTIONS',
  'USER_PROFILE_AUDIT_ACTIONS',
] as const;

function listAuditActionExportNames(): string[] {
  const names: string[] = [];
  const pattern = /export const ([A-Z0-9_]+_AUDIT_(?:ACTIONS|COMMANDS)) = \{/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    names.push(match[1]);
  }
  return names;
}

const WAVE1_ACTIONS = [
  'PROGRAM_CREATED',
  'PROGRAM_DELETED',
  'TEAM_CREATED',
  'TEAM_JOINED',
  'APPLICATION_SUBMITTED',
] as const;

const backendActions = [
  ...new Set(
    listAuditActionExportNames().flatMap((name) => extractActionValues(name)),
  ),
];

const frontendActions: readonly string[] = AUDIT_LOG_ACTIONS;

describe('감사 로그 action registry가 backend와 동기화되어 있다', () => {
  it('파싱 자체가 살아 있다(백엔드 파일 구조 변경으로 조용히 공허해지지 않는다)', () => {
    expect(listAuditActionExportNames()).toEqual(
      expect.arrayContaining([...REQUIRED_ACTION_REGISTRIES]),
    );
    expect(backendActions.length).toBeGreaterThan(0);
    expect(backendActions).toContain('PROGRAM_DELETED');
    for (const action of WAVE1_ACTIONS) {
      if (new RegExp(`:\\s*'${action}'`).test(source)) {
        expect(backendActions).toContain(action);
      }
    }
  });

  it('frontend registry에 PROGRAM_DELETED와 wave 1 action이 있다', () => {
    for (const action of WAVE1_ACTIONS) {
      expect(AUDIT_LOG_ACTIONS).toContain(action);
    }
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
    // Wave 1 frontend literals may land before the matching backend consts.
    const allowedFrontendAhead = WAVE1_ACTIONS.filter(
      (action) => !backendActions.includes(action),
    );

    expect(
      [...extraInFrontend].sort(),
      `frontend에는 있지만 backend registry에는 없는 action: ${
        extraInFrontend.join(', ') || '없음'
      }`,
    ).toEqual([...allowedFrontendAhead].sort());
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

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUDIT_LOG_TARGET_TYPE_LABELS } from './describe';

const BACKEND_SRC = path.resolve(__dirname, '../../../../backend/src');
const TARGET_TYPE_LITERAL = /targetType:\s*'([A-Z][A-Z0-9_]*)'/g;

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
      continue;
    }
    if (
      entry.endsWith('.ts') &&
      !entry.endsWith('.spec.ts') &&
      !entry.endsWith('.test.ts')
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

function extractBackendTargetTypes(): string[] {
  const values = new Set<string>();
  for (const file of collectSourceFiles(BACKEND_SRC)) {
    const source = readFileSync(file, 'utf-8');
    for (const match of source.matchAll(TARGET_TYPE_LITERAL)) {
      values.add(match[1]);
    }
  }
  return [...values];
}

describe('감사 로그 targetType 한국어 라벨이 backend 기록부와 동기화되어 있다', () => {
  const backendTargetTypes = extractBackendTargetTypes();

  it('파싱 자체가 살아 있다(backend 구조 변경으로 조용히 공허해지지 않는다)', () => {
    expect(backendTargetTypes.length).toBeGreaterThan(0);
  });

  it('backend가 실제로 기록하는 모든 targetType에 한국어 라벨이 있다', () => {
    const missing = backendTargetTypes.filter(
      (targetType) => !Object.hasOwn(AUDIT_LOG_TARGET_TYPE_LABELS, targetType),
    );

    expect(
      missing,
      `한국어 라벨이 없는 targetType: ${missing.join(', ') || '없음'}`,
    ).toEqual([]);
  });
});

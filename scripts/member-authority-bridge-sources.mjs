#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * bridge 정적 검사가 **실제로 훑어야 하는 생산 소스**의 목록을 만든다.
 *
 * 검사기(`member-authority-bridge-contract.mjs`)는 legacy 권한을 정본으로 읽는
 * 코드를 잡는다. 그 검사가 의미를 가지려면 합성 문자열이 아니라 저장소에 실제로
 * 있는 파일을 봐야 한다 — 단위 테스트만 돌리면 "검사기가 동작한다"는 것만 알 뿐
 * "이 저장소가 규칙을 지킨다"는 것은 아무도 확인하지 않는다.
 *
 * 포함: `apps/backend/src`, `apps/backend/prisma` 아래 추적 중인 `.ts`.
 *
 * 제외는 세 가지뿐이고 **각각 이유가 다르다**.
 *
 *   - `*.spec.ts` · `*.test.ts` — 테스트는 legacy 모양을 일부러 만들어 낸다
 *     (회귀가 되살아나는지 보려면 그 모양을 적을 수 있어야 한다).
 * 픽스처·지원 모듈(`*.fixture.ts`, `*-support.ts` 등)은 **제외하지 않는다.** 직전
 * 프런트엔드 계약을 그대로 옮겨 둔 `previous-frontend-contract.fixture.ts`조차
 * 제외하지 않는다 — 그 파일의 legacy 철자는 `roleRequestPage` 같은 HTTP 필드 이름이라
 * 검사기가 보는 Prisma 접근 패턴에 애초에 걸리지 않는다. 걸리지 않는 파일을 제외
 * 목록에 올려 두면 나중에 그 파일이 진짜 위반을 담게 되어도 아무도 모른다.
 *
 * 제외 목록이 조용히 넓어지지 않게 `member-authority-bridge-contract.test.mjs`가
 * 이 정책을 따로 잠근다.
 */

const INCLUDE_ROOTS = ['apps/backend/src', 'apps/backend/prisma'];

const EXCLUDE_PATTERNS = [/\.spec\.ts$/, /\.test\.ts$/];

export function isScannedSource(path) {
  if (!path.endsWith('.ts')) {
    return false;
  }
  if (!INCLUDE_ROOTS.some((root) => path.startsWith(`${root}/`))) {
    return false;
  }
  return !EXCLUDE_PATTERNS.some((pattern) => pattern.test(path));
}

export function selectScannedSources(paths) {
  return paths.filter(isScannedSource).sort();
}

export function listTrackedSources(repositoryRoot) {
  const tracked = execFileSync(
    'git',
    ['ls-files', '--', ...INCLUDE_ROOTS.map((root) => `${root}/**/*.ts`)],
    { cwd: repositoryRoot, encoding: 'utf8' },
  );
  return selectScannedSources(
    tracked.split('\n').filter((line) => line.length > 0),
  );
}

export { INCLUDE_ROOTS, EXCLUDE_PATTERNS };

function main() {
  const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const sources = listTrackedSources(repositoryRoot);
  if (sources.length === 0) {
    process.stderr.write(
      'bridge source scan: no production sources matched — the include policy is broken\n',
    );
    process.exit(2);
  }
  process.stdout.write(`${sources.join('\n')}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

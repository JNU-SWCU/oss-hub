import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(here, '..', '..', '..', 'backend');
const require = createRequire(join(backendRoot, 'package.json'));
const { Prisma } = require('@prisma/client');

/**
 * 스택 기동 스크립트는 `.mjs`라 typecheck가 보지 않는다. 그래서 migration이 모델을 지워도
 * 컴파일 단계에서 걸리는 것이 없고, Prisma 클라이언트에서 사라진 델리게이트는 `undefined`가
 * 되어 **호출하는 순간**에야 터진다 — 그 자리가 하필 `pnpm --filter frontend e2e`의 기동
 * 단계라 스펙은 한 줄도 못 돌고 죽는다(#1084: 이관으로 사라진 옛 Submission 원장 호출).
 *
 * CI가 Playwright를 돌리지 않기로 한 이상(2026-08-11 PM 결정) 이 부패를 잡을 싼 그물은
 * 여기뿐이다. 그래서 델리게이트 이름을 생성된 datamodel과 대조한다 — 이름이 하드코딩된
 * 목록이 아니라 schema에서 나오므로, 다음 이관이 또 무엇을 지우든 같은 방식으로 걸린다.
 */
const supportScripts = readdirSync(here)
  .filter((entry) => entry.endsWith('.mjs'))
  .map((entry) => ({
    name: entry,
    source: readFileSync(join(here, entry), 'utf8'),
  }));

const clientDelegates = new Set<string>(
  (Prisma.dmmf.datamodel.models as readonly { name: string }[]).map(
    (model) => `${model.name[0]?.toLowerCase() ?? ''}${model.name.slice(1)}`,
  ),
);

function referencedDelegates(source: string): readonly string[] {
  return [
    ...new Set(
      [...source.matchAll(/\bprisma\.([a-z][A-Za-z0-9]*)\./g)].flatMap(
        (match) => match[1] ?? [],
      ),
    ),
  ].sort();
}

describe('스택 기동 스크립트 — Prisma 원장 계약', () => {
  it('시드가 부르는 모델이 모두 생성된 클라이언트에 있다', () => {
    // Given: 기동이 실행하는 support 스크립트 전부.
    expect(supportScripts.map((script) => script.name)).toContain(
      'seed-deadline-digest.mjs',
    );

    // When: 각 스크립트가 이름으로 부르는 Prisma 델리게이트를 모은다.
    const missing = supportScripts.flatMap((script) =>
      referencedDelegates(script.source)
        .filter((delegate) => !clientDelegates.has(delegate))
        .map((delegate) => `${script.name}: prisma.${delegate}`),
    );

    // Then: 사라진 모델을 부르는 자리가 없다.
    expect(missing).toEqual([]);
  });

  it('마감 다이제스트 시드가 실제로 Prisma를 쓴다', () => {
    // 위 판정이 "델리게이트를 하나도 못 찾아서" 조용히 통과하지 않게 잠근다.
    const seed = supportScripts.find(
      (script) => script.name === 'seed-deadline-digest.mjs',
    );
    expect(referencedDelegates(seed?.source ?? '').length).toBeGreaterThan(0);
  });
});

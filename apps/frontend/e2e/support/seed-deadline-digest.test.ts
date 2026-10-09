import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(here, '..', '..', '..', 'backend');
const require = createRequire(join(backendRoot, 'package.json'));
const { Prisma } = require('@prisma/client') as {
  Prisma: { dmmf: { datamodel: { models: readonly { name: string }[] } } };
};

const supportScripts = readdirSync(here)
  .filter((entry) => entry.endsWith('.mjs'))
  .map((entry) => ({
    name: entry,
    source: readFileSync(join(here, entry), 'utf8'),
  }));

const clientDelegates = new Set<string>(
  Prisma.dmmf.datamodel.models.map(
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
    expect(supportScripts.map((script) => script.name)).toContain(
      'seed-deadline-digest.mjs',
    );

    const missing = supportScripts.flatMap((script) =>
      referencedDelegates(script.source)
        .filter((delegate) => !clientDelegates.has(delegate))
        .map((delegate) => `${script.name}: prisma.${delegate}`),
    );

    expect(missing).toEqual([]);
  });

  it('마감 다이제스트 시드가 실제로 Prisma를 쓴다', () => {
    const seed = supportScripts.find(
      (script) => script.name === 'seed-deadline-digest.mjs',
    );
    expect(referencedDelegates(seed?.source ?? '').length).toBeGreaterThan(0);
  });
});
